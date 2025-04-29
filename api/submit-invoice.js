// Import the Airtable library
const Airtable = require('airtable');

// This is the main function Vercel will run
export default async function handler(request, response) {

    // 1. Only allow POST requests
    if (request.method !== 'POST') {
        console.log(`Received non-POST request: ${request.method}`);
        response.setHeader('Allow', ['POST']); // Tell the client what methods are allowed
        // Send a 405 Method Not Allowed error
        response.status(405).json({ success: false, message: `Method ${request.method} Not Allowed` });
        return; // Stop processing
    }

    console.log('Received POST request to /api/submit-invoice');

    // 2. Get the fileInfo from the request body
    // Vercel automatically parses JSON bodies if Content-Type is application/json
    const fileInfo = request.body?.fileInfo;

    if (!fileInfo || typeof fileInfo !== 'object' || !fileInfo.uuid || !fileInfo.cdnUrl || !fileInfo.name) {
        console.error('Invalid or missing fileInfo in request body:', request.body);
        response.status(400).json({ success: false, message: 'Bad Request: Missing or invalid "fileInfo" in request body.' });
        return;
    }

    console.log('Received fileInfo:', fileInfo);

    // 4. Configure Airtable connection using Environment Variables
    // IMPORTANT: These MUST be set in your Vercel project settings, not hardcoded here!
    const apiKey = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
    const baseId = process.env.AIRTABLE_BASE_ID; // Get Base ID from environment as well
    const tableName = 'Invoices'; // Your specific table name

    // Check if environment variables are set
    if (!apiKey || !baseId) {
        console.error('Server Configuration Error: Missing AIRTABLE_PERSONAL_ACCESS_TOKEN or AIRTABLE_BASE_ID in environment variables.');
        response.status(500).json({ success: false, message: 'Server configuration error. Unable to connect to database.' });
        return;
    }

    try {
        // Initialize Airtable connection
        Airtable.configure({ apiKey: apiKey });
        const base = Airtable.base(baseId);

        // 6. Prepare data to save in Airtable
        const dataToSave = {
            // Convert the fileInfo object into a JSON string for storage in a text field
            'FileWidgetInfo': JSON.stringify(fileInfo, null, 2), // Pretty-print JSON string
            // Set the initial status
            'Status': 'Pending'
        };

        console.log('Attempting to create Airtable record with data:', dataToSave);

        // 5. Create a new record in the specified table
        // Airtable's create method expects an array of records to create
        const records = await base(tableName).create([
            { fields: dataToSave }
        ]);

        // Check if record creation was successful and we got a result
        if (!records || records.length === 0) {
            throw new Error('Airtable record creation did not return the expected result.');
        }

        const newRecord = records[0]; // Get the first (and only) created record
        const newRecordId = newRecord.getId();

        console.log(`Successfully created Airtable record. ID: ${newRecordId}`);

        // 8. Send success response back to the frontend
        response.status(200).json({
            success: true,
            invoiceId: newRecordId // Send the new record's ID back
        });

    } catch (error) {
        // 7. Handle potential errors during Airtable operation
        console.error('Error interacting with Airtable:', error);
        response.status(500).json({
            success: false,
            message: 'Error saving data to database.',
            // Optionally include more error detail (be cautious about exposing too much)
            // errorDetail: error.message
        });
    }
}