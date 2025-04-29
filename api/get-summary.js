// Import the Airtable library
const Airtable = require('airtable');

// This is the main function Vercel will run
export default async function handler(request, response) {

    // 1. Only allow GET requests
    if (request.method !== 'GET') {
        console.log(`Received non-GET request: ${request.method}`);
        response.setHeader('Allow', ['GET']); // Tell the client what methods are allowed
        response.status(405).json({ status: 'Error', message: `Method ${request.method} Not Allowed` });
        return; // Stop processing
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
    const tableName = 'Invoices'; // Your specific table name

    // Check if environment variables are set
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
        const recordFields = record.fields; // Get all fields from the fetched record

        switch (status) {
            case 'Processed':
                // 8. Return 'Processed' status and Simplified fields
                const summaryData = { status: 'Processed' };
                // Iterate through all fields and add the ones starting with 'Simplified_'
                for (const key in recordFields) {
                    if (key.startsWith('Simplified_')) {
                        summaryData[key.toLowerCase()] = recordFields[key]; // Use lowercase keys in response JSON
                        // or use original case: summaryData[key] = recordFields[key];
                    }
                }
                response.status(200).json(summaryData);
                break;

            case 'Pending':
            case 'Processing':
                // 9. Return 'Processing' status
                response.status(200).json({ status: 'Processing' });
                break;

            case 'Error':
                // 10. Return 'Error' status
                response.status(200).json({ status: 'Error' });
                break;

            default:
                // Handle unexpected status values
                console.warn(`Record ${invoiceId} has unexpected status: ${status}`);
                response.status(200).json({ status: 'Unknown' }); // Or maybe an error status code
                break;
        }

    } catch (error) {
        // 6 & 11. Handle potential errors (including record not found)
        console.error(`Error fetching record ${invoiceId} from Airtable:`, error);

        // Check if the error indicates "Not Found" (Airtable API typically returns 404 status code in error)
        // The exact error structure might vary, check Airtable.js docs or error logs if needed
        if (error.statusCode === 404 || error.message?.includes('NOT_FOUND')) {
             console.log(`Record ${invoiceId} not found.`);
             response.status(404).json({ status: 'Not Found' });
        } else {
            // For any other errors during fetch
            response.status(500).json({
                status: 'Error',
                message: 'Failed to retrieve status from database.'
                // errorDetail: error.message // Be cautious about exposing too much detail
            });
        }
    }
}