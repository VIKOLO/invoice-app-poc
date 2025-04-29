// Import the Airtable library
const Airtable = require('airtable');

// --- Calculation Logic ---
// Takes the detailedJson (expected to be an array of invoice objects)
function calculateSummary(detailedJsonArray) {
    // Basic validation of input
    if (!Array.isArray(detailedJsonArray) || detailedJsonArray.length === 0) {
        console.error("calculateSummary received invalid input:", detailedJsonArray);
        throw new Error("Invalid input for calculation: Expected a non-empty array of invoice objects.");
    }

    // Initialize summary object with defaults
    const summary = {
        simplified_Address: null,
        simplified_Retailer: null,
        simplified_GridOp: null,
        simplified_Period: null,
        simplified_TotalCost: 0,
        simplified_UsedKwh: 0,
        simplified_SoldKwh: 0,
        simplified_AvgPrice: 0,
        simplified_FixedCost: 0,
    };

    try {
        // --- Extract Basic Info (Address, Period, kWh) ---
        // Iterate to find the first non-null address
        for (const invoice of detailedJsonArray) {
            if (invoice?.facility_address) {
                summary.simplified_Address = invoice.facility_address.replace(/\n/g, ', '); // Replace newlines for single line field
                break; // Stop after finding the first one
            }
        }
        // Get period from the first invoice (assuming all invoices in array share the period)
        const firstInvoice = detailedJsonArray[0];
        if (firstInvoice?.invoice_period?.from) {
             try {
                 const fromDate = new Date(firstInvoice.invoice_period.from);
                 // Format as YYYY-MM. Add 1 to month because getMonth() is 0-indexed. Pad month if needed.
                 summary.simplified_Period = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`;
             } catch(e) {
                 console.warn("Could not parse invoice_period.from:", firstInvoice.invoice_period.from, e);
                 // Keep summary.simplified_Period as null
             }
        }
        // Get consumption/production from the first invoice (assuming consistency)
        summary.simplified_UsedKwh = firstInvoice?.total_consumption_kwh || 0;
        summary.simplified_SoldKwh = firstInvoice?.total_production_kwh || 0;


        // --- Calculate Aggregated Values (Costs, Find Providers) ---
        let totalFixedCostRaw = 0;
        summary.simplified_TotalCost = 0; // Reset just in case

        detailedJsonArray.forEach(invoice => {
            if (!invoice) return; // Skip null/undefined invoices in the array

            // Sum total payable SEK
            summary.simplified_TotalCost += (invoice.total_payable_sek || 0);

            // Iterate line items to find providers and sum fixed costs
            if (invoice.line_items && Array.isArray(invoice.line_items)) {
                invoice.line_items.forEach(item => {
                    if (!item) return; // Skip null/undefined items

                    // Find first Retailer ('Elhandel') source
                    if (item.category === 'Elhandel' && !summary.simplified_Retailer) {
                        summary.simplified_Retailer = invoice.invoice_source;
                    }
                    // Find first Grid Operator ('Elnät') source
                    if (item.category === 'Elnät' && !summary.simplified_GridOp) {
                        summary.simplified_GridOp = invoice.invoice_source;
                    }

                    // Sum fixed costs
                    if (item.type === 'fixed') {
                        const grossSek = item.gross_sek || 0;
                        // Normalize if unit is 'dagar' (days)
                        if (item.unit === 'dagar' && typeof item.quantity === 'number' && item.quantity > 0) {
                             totalFixedCostRaw += (grossSek / item.quantity) * 30.44; // Average days/month
                        } else {
                             // Assume other fixed costs are already monthly or per-item
                             totalFixedCostRaw += grossSek;
                        }
                    }
                });
            }
        });

        // Finalize calculations and formatting

        // Calculate average price (SEK/kWh)
        if (summary.simplified_UsedKwh && summary.simplified_UsedKwh !== 0) {
            // Round to 3 decimal places
            summary.simplified_AvgPrice = parseFloat((summary.simplified_TotalCost / summary.simplified_UsedKwh).toFixed(3));
        } else {
            summary.simplified_AvgPrice = 0; // Avoid division by zero
        }

        // Assign final fixed cost, rounded to 2 decimal places
        summary.simplified_FixedCost = parseFloat(totalFixedCostRaw.toFixed(2));

        // Ensure numeric fields are numbers and handle potential NaN results, round totals
        summary.simplified_TotalCost = isNaN(summary.simplified_TotalCost) ? 0 : parseFloat(summary.simplified_TotalCost.toFixed(2));
        summary.simplified_UsedKwh = isNaN(summary.simplified_UsedKwh) ? 0 : parseFloat(summary.simplified_UsedKwh.toFixed(2));
        summary.simplified_SoldKwh = isNaN(summary.simplified_SoldKwh) ? 0 : parseFloat(summary.simplified_SoldKwh.toFixed(2));
        summary.simplified_AvgPrice = isNaN(summary.simplified_AvgPrice) ? 0 : summary.simplified_AvgPrice;
        summary.simplified_FixedCost = isNaN(summary.simplified_FixedCost) ? 0 : summary.simplified_FixedCost;


        console.log("Calculation successful. Summary:", summary);
        return summary;

    } catch (error) {
        console.error("Error during summary calculation:", error);
        // Re-throw the error to be caught by the main handler
        throw new Error(`Calculation failed: ${error.message}`);
    }
}


// --- Vercel Serverless Function Handler ---
export default async function handler(request, response) {

    // 1. Only allow POST requests
    if (request.method !== 'POST') {
        console.log(`Received non-POST request: ${request.method}`);
        response.setHeader('Allow', ['POST']);
        response.status(405).json({ success: false, message: `Method ${request.method} Not Allowed` });
        return;
    }

    console.log('Received POST request to /api/submit-interpretation');

    // 2. Read and validate request body
    const { recordId, detailedJson } = request.body;

    if (!recordId || typeof recordId !== 'string' || !recordId.startsWith('rec')) {
        console.error('Invalid or missing recordId:', recordId);
        return response.status(400).json({ success: false, message: 'Bad Request: Missing or invalid "recordId".' });
    }
    // Basic check for detailedJson - calculation function will do more detailed check
    if (!detailedJson || typeof detailedJson !== 'object') {
         console.error('Invalid or missing detailedJson:', detailedJson);
        return response.status(400).json({ success: false, message: 'Bad Request: Missing or invalid "detailedJson".' });
    }

    console.log(`Processing interpretation for Record ID: ${recordId}`);

    // 4. Configure Airtable connection using Environment Variables
    const apiKey = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableName = 'Invoices';

    if (!apiKey || !baseId) {
        console.error('Server Configuration Error: Missing Airtable credentials in environment variables.');
        return response.status(500).json({ success: false, message: 'Server configuration error.' });
    }

    try {
        // 5. Call the Calculation Logic
        console.log('Calculating summary from detailedJson...');
        const summary = calculateSummary(detailedJson); // Assume detailedJson is the array

        // 7. Prepare Airtable Update Payload
        const fieldsToUpdate = {
            'DetailedJSON': JSON.stringify(detailedJson, null, 2), // Store the original detailed JSON as string
            'Status': 'Processed',
            // Map calculated summary fields to Airtable field names
            'Simplified_Address': summary.simplified_Address,
            'Simplified_Retailer': summary.simplified_Retailer,
            'Simplified_GridOp': summary.simplified_GridOp,
            'Simplified_Period': summary.simplified_Period,
            'Simplified_TotalCost': summary.simplified_TotalCost,
            'Simplified_UsedKwh': summary.simplified_UsedKwh,
            'Simplified_SoldKwh': summary.simplified_SoldKwh,
            'Simplified_AvgPrice': summary.simplified_AvgPrice,
            'Simplified_FixedCost': summary.simplified_FixedCost,
        };

        // Remove null fields before sending to Airtable, as it might cause issues
        // (Airtable generally ignores fields not present in the update payload)
        Object.keys(fieldsToUpdate).forEach(key => {
            if (fieldsToUpdate[key] === null || fieldsToUpdate[key] === undefined) {
                // It's often better to just not send the key if the value is null/undefined
                 delete fieldsToUpdate[key];
                // Alternatively, explicitly set to empty string or 0 if appropriate for your Airtable schema
                // if (typeof fieldsToUpdate[key] === 'string') fieldsToUpdate[key] = '';
                // if (typeof fieldsToUpdate[key] === 'number') fieldsToUpdate[key] = 0;
            }
        });


        console.log(`Updating Airtable record ${recordId} with processed data...`);

        // 8. Update Airtable Record
        Airtable.configure({ apiKey: apiKey });
        const base = Airtable.base(baseId);

        // Airtable update expects an array of records to update, each with id and fields
        await base(tableName).update([
            {
                "id": recordId,
                "fields": fieldsToUpdate
            }
        ]);

        console.log(`Successfully updated Airtable record ${recordId}.`);

        // 10. Send success response
        response.status(200).json({ success: true });

    } catch (error) {
        // 6 & 9. Handle errors from calculation or Airtable update
        console.error(`Error processing interpretation for ${recordId}:`, error);
        // Attempt to update status to Error in Airtable if possible (best effort)
        try {
            Airtable.configure({ apiKey: apiKey });
            const base = Airtable.base(baseId);
            await base(tableName).update([ { "id": recordId, "fields": { 'Status': 'Error' } } ]);
             console.log(`Set status to 'Error' for record ${recordId} due to processing failure.`);
        } catch (updateError) {
             console.error(`Failed to update status to 'Error' for record ${recordId}:`, updateError);
        }

        response.status(500).json({
            success: false,
            message: `Error processing interpretation: ${error.message}`
        });
    }
}