// Import the Airtable library
const Airtable = require('airtable');

// This is the main function Vercel will run
export default async function handler(request, response) {

    // 1. Only allow GET requests
    if (request.method !== 'GET') {
        console.log(`Received non-GET request: ${request.method}`);
        response.setHeader('Allow', ['GET']);
        response.status(405).json({ status: 'Error', message: `Method ${request.method} Not Allowed` });
        return;
    }

    console.log('Received GET request to /api/get-summary');

    // 2. Read and validate invoiceId from query parameters
    const invoiceId = request.query.invoiceId;

    if (!invoiceId || typeof invoiceId !== 'string' || !invoiceId.startsWith('rec')) {
        console.error('Invalid or missing invoiceId in query:', request.query);
        response.status(400).json({ status: 'Error', message: 'Bad Request: Missing or invalid "invoiceId" query parameter.' });
        return;
    }

    console.log(`Fetching summary for Invoice ID: ${invoiceId}`);

    // 4. Configure Airtable connection using Environment Variables
    const apiKey = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableName = 'Invoices';

    if (!apiKey || !baseId) {
        console.error('Server Configuration Error: Missing Airtable credentials in environment variables.');
        response.status(500).json({ status: 'Error', message: 'Server configuration error. Unable to connect to database.' });
        return;
    }

    try {
        // Initialize Airtable connection
        Airtable.configure({ apiKey: apiKey });
        const base = Airtable.base(baseId);

        // 5. Fetch the specific record from Airtable
        console.log(`Attempting to fetch record ${invoiceId} from Airtable...`);
        const record = await base(tableName).find(invoiceId);

        console.log(`Successfully fetched record ${invoiceId}. Status: ${record.fields.Status}`);

        // 7. Check the Status field
        const status = record.fields.Status;
        const recordFields = record.fields;

        switch (status) {
            case 'Processed':
                const summaryData = { status: 'Processed' };
                for (const key in recordFields) {
                    if (key.startsWith('Simplified_')) {
                        // *** KORRIGERING: Konvertera HELA nyckeln till små bokstäver ***
                        // Exempel: "Simplified_Address" -> "simplified_address"
                        //         "Simplified_AvgPrice" -> "simplified_avgprice"
                        //         "Simplified_VariableCostKwh" -> "simplified_variablecostkwh"
                        const jsonKey = key.toLowerCase(); // Konvertera hela nyckeln till små bokstäver
                        summaryData[jsonKey] = recordFields[key];
                        console.log(`Mapping Airtable field ${key} to JSON key ${jsonKey}`);
                    }
                }
                console.log("Returning summaryData:", summaryData);
                response.status(200).json(summaryData);
                break;

            // Resten av switch-satsen är oförändrad...
            case 'Pending':
            case 'Processing':
                response.status(200).json({ status: 'Processing' });
                break;
            case 'Error':
                response.status(200).json({ status: 'Error' });
                break;
            default:
                console.warn(`Record ${invoiceId} has unexpected status: ${status}`);
                response.status(200).json({ status: 'Unknown' });
                break;
        }

    } catch (error) {
        // Felhantering oförändrad...
        console.error(`Error fetching record ${invoiceId} from Airtable:`, error);
        if (error.statusCode === 404 || error.message?.includes('NOT_FOUND')) {
             console.log(`Record ${invoiceId} not found.`);
             response.status(404).json({ status: 'Not Found' });
        } else {
            response.status(500).json({ status: 'Error', message: 'Failed to retrieve status from database.' });
        }
    }
}
