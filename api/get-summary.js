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
                // 8. Return 'Processed' status and ALL Simplified fields found
                const summaryData = { status: 'Processed' }; // Start with status

                // *** VIKTIGT: Loopa igenom ALLA fält från Airtable ***
                for (const key in recordFields) {
                    // Om fältnamnet i Airtable börjar med "Simplified_"
                    if (key.startsWith('Simplified_')) {
                        // Skapa ett JSON-nyckelnamn med liten bokstav i början
                        const jsonKey = key.charAt(0).toLowerCase() + key.slice(1);
                        // Lägg till fältet och dess värde i svars-JSON:en
                         summaryData[jsonKey] = recordFields[key];
                         console.log(`Mapping Airtable field ${key} to JSON key ${jsonKey}`); // Lägg till loggning
                    }
                }
                // Logga hela objektet som ska skickas tillbaka
                console.log("Returning summaryData:", summaryData);
                response.status(200).json(summaryData);
                break;

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
        // Handle errors (including record not found)
        console.error(`Error fetching record ${invoiceId} from Airtable:`, error);
        if (error.statusCode === 404 || error.message?.includes('NOT_FOUND')) {
             console.log(`Record ${invoiceId} not found.`);
             response.status(404).json({ status: 'Not Found' });
        } else {
            response.status(500).json({ status: 'Error', message: 'Failed to retrieve status from database.' });
        }
    }
}
