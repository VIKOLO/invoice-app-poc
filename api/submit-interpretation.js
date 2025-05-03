// Import the Airtable library
const Airtable = require('airtable');

// --- Calculation Logic ---
function calculateSummary(detailedJsonArray) {
    if (!Array.isArray(detailedJsonArray) || detailedJsonArray.length === 0) {
        console.error("calculateSummary received invalid input:", detailedJsonArray);
        throw new Error("Invalid input for calculation: Expected a non-empty array of invoice objects.");
    }

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
        // *** NY: Initialisera nytt fält ***
        simplified_VariableCostKwh: 0,
    };

    try {
        // --- Extract Basic Info ---
        for (const invoice of detailedJsonArray) {
            if (invoice?.facility_address && !summary.simplified_Address) {
                summary.simplified_Address = invoice.facility_address.replace(/\n/g, ', ');
            }
        }
        const firstInvoice = detailedJsonArray[0];
        if (firstInvoice?.invoice_period?.from) {
             try {
                 const fromDate = new Date(firstInvoice.invoice_period.from);
                 summary.simplified_Period = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`;
             } catch(e) { console.warn("Could not parse invoice_period.from:", firstInvoice.invoice_period.from, e); }
        }
        // Använd UsedKwh från första fakturan som bas (kan behöva justeras om de skiljer sig)
        summary.simplified_UsedKwh = firstInvoice?.total_consumption_kwh || 0;
        summary.simplified_SoldKwh = firstInvoice?.total_production_kwh || 0;


        // --- Calculate Aggregated Values ---
        let totalFixedCostRaw = 0;
        // *** NY: Variabel för att summera rörliga bruttokostnader ***
        let totalVariableGrossCost = 0;
        summary.simplified_TotalCost = 0; // Reset

        detailedJsonArray.forEach(invoice => {
            if (!invoice) return;

            summary.simplified_TotalCost += (invoice.total_payable_sek || 0);

            if (invoice.line_items && Array.isArray(invoice.line_items)) {
                invoice.line_items.forEach(item => {
                    if (!item) return;

                    // Hitta leverantörer
                    if (item.category === 'Elhandel' && !summary.simplified_Retailer) { summary.simplified_Retailer = invoice.invoice_source; }
                    if (item.category === 'Elnät' && !summary.simplified_GridOp) { summary.simplified_GridOp = invoice.invoice_source; }

                    // Summera fasta kostnader
                    if (item.type === 'fixed') {
                        const grossSek = item.gross_sek || 0;
                        if (item.unit === 'dagar' && typeof item.quantity === 'number' && item.quantity > 0) {
                             totalFixedCostRaw += (grossSek / item.quantity) * 30.44;
                        } else { totalFixedCostRaw += grossSek; }
                    }

                    // *** NY: Summera rörliga bruttokostnader för förbrukning ***
                    if (item.type === 'variable' && item.flow_type === 'consumption') {
                        totalVariableGrossCost += (item.gross_sek || 0);
                    }
                });
            }
        });

        // --- Finalize calculations ---

        // Beräkna snittpris (totalkostnad / användning)
        if (summary.simplified_UsedKwh && summary.simplified_UsedKwh > 0) {
            summary.simplified_AvgPrice = parseFloat((summary.simplified_TotalCost / summary.simplified_UsedKwh).toFixed(3));
        } else { summary.simplified_AvgPrice = 0; }

        // *** NY: Beräkna rörlig kostnad per kWh ***
        if (summary.simplified_UsedKwh && summary.simplified_UsedKwh > 0) {
            summary.simplified_VariableCostKwh = parseFloat((totalVariableGrossCost / summary.simplified_UsedKwh).toFixed(3));
        } else { summary.simplified_VariableCostKwh = 0; }


        // Slutliga värden och avrundning
        summary.simplified_FixedCost = parseFloat(totalFixedCostRaw.toFixed(2));
        summary.simplified_TotalCost = isNaN(summary.simplified_TotalCost) ? 0 : parseFloat(summary.simplified_TotalCost.toFixed(2));
        summary.simplified_UsedKwh = isNaN(summary.simplified_UsedKwh) ? 0 : parseFloat(summary.simplified_UsedKwh.toFixed(2));
        summary.simplified_SoldKwh = isNaN(summary.simplified_SoldKwh) ? 0 : parseFloat(summary.simplified_SoldKwh.toFixed(2));
        summary.simplified_AvgPrice = isNaN(summary.simplified_AvgPrice) ? 0 : summary.simplified_AvgPrice;
        summary.simplified_FixedCost = isNaN(summary.simplified_FixedCost) ? 0 : summary.simplified_FixedCost;
        // *** NY: Säkerställ att rörligt pris är ett nummer ***
        summary.simplified_VariableCostKwh = isNaN(summary.simplified_VariableCostKwh) ? 0 : summary.simplified_VariableCostKwh;

        console.log("Calculation successful. Summary:", summary);
        return summary;

    } catch (error) {
        console.error("Error during summary calculation:", error);
        throw new Error(`Calculation failed: ${error.message}`);
    }
}


// --- Vercel Serverless Function Handler ---
export default async function handler(request, response) {

    if (request.method !== 'POST') { /* ... (samma felhantering som förut) ... */
        console.log(`Received non-POST request: ${request.method}`); response.setHeader('Allow', ['POST']); response.status(405).json({ success: false, message: `Method ${request.method} Not Allowed` }); return; }

    console.log('Received POST request to /api/submit-interpretation');
    const { recordId, detailedJson } = request.body;
    if (!recordId || typeof recordId !== 'string' || !recordId.startsWith('rec')) { /* ... */ return response.status(400).json({ success: false, message: 'Bad Request: Missing or invalid "recordId".' }); }
    if (!detailedJson || typeof detailedJson !== 'object') { /* ... */ return response.status(400).json({ success: false, message: 'Bad Request: Missing or invalid "detailedJson".' }); }
    console.log(`Processing interpretation for Record ID: ${recordId}`);

    const apiKey = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableName = 'Invoices';
    if (!apiKey || !baseId) { /* ... */ console.error('Server Configuration Error...'); return response.status(500).json({ success: false, message: 'Server configuration error.' }); }

    try {
        console.log('Calculating summary from detailedJson...');
        const summary = calculateSummary(detailedJson);

        // *** NY: Inkludera det nya fältet i uppdateringen ***
        const fieldsToUpdate = {
            'DetailedJSON': JSON.stringify(detailedJson, null, 2),
            'Status': 'Processed',
            'Simplified_Address': summary.simplified_Address,
            'Simplified_Retailer': summary.simplified_Retailer,
            'Simplified_GridOp': summary.simplified_GridOp,
            'Simplified_Period': summary.simplified_Period,
            'Simplified_TotalCost': summary.simplified_TotalCost,
            'Simplified_UsedKwh': summary.simplified_UsedKwh,
            'Simplified_SoldKwh': summary.simplified_SoldKwh,
            'Simplified_AvgPrice': summary.simplified_AvgPrice,
            'Simplified_FixedCost': summary.simplified_FixedCost,
            'Simplified_VariableCostKwh': summary.simplified_VariableCostKwh, // Lägg till det nya fältet
            // Lägg även till Elomrade här om/när du implementerar benchmark
            // 'Elomrade': summary.elomrade // Exempel
        };

        // Ta bort null/undefined värden innan uppdatering
        Object.keys(fieldsToUpdate).forEach(key => { if (fieldsToUpdate[key] === null || fieldsToUpdate[key] === undefined) { delete fieldsToUpdate[key]; } });

        console.log(`Updating Airtable record ${recordId} with processed data...`);
        Airtable.configure({ apiKey: apiKey });
        const base = Airtable.base(baseId);
        await base(tableName).update([ { "id": recordId, "fields": fieldsToUpdate } ]);
        console.log(`Successfully updated Airtable record ${recordId}.`);

        response.status(200).json({ success: true });

    } catch (error) { /* ... (samma felhantering som förut, inkl försök att sätta Status='Error') ... */
        console.error(`Error processing interpretation for ${recordId}:`, error);
        try { Airtable.configure({ apiKey: apiKey }); const base = Airtable.base(baseId); await base(tableName).update([ { "id": recordId, "fields": { 'Status': 'Error' } } ]); console.log(`Set status to 'Error' for record ${recordId}.`);
        } catch (updateError) { console.error(`Failed to update status to 'Error' for record ${recordId}:`, updateError); }
        response.status(500).json({ success: false, message: `Error processing interpretation: ${error.message}` });
    }
}
