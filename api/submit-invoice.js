// Import the Airtable library
const Airtable = require('airtable');

// This is the main function Vercel will run
export default async function handler(request, response) {

    // 1. Only allow POST requests
    if (request.method !== 'POST') {
        console.log(`Received non-POST request: ${request.method}`);
        response.setHeader('Allow', ['POST']);
        response.status(405).json({ success: false, message: `Method ${request.method} Not Allowed` });
        return;
    }

    console.log('Received POST request to /api/submit-invoice');

    // 2. Get fileInfo AND userEmail from the request body
    const fileInfo = request.body?.fileInfo;
    // *** NY: Hämta userEmail ***
    const userEmail = request.body?.userEmail;

    // Validate fileInfo
    if (!fileInfo || typeof fileInfo !== 'object' || !fileInfo.uuid || !fileInfo.cdnUrl || !fileInfo.name) {
        console.error('Invalid or missing fileInfo in request body:', request.body);
        response.status(400).json({ success: false, message: 'Bad Request: Missing or invalid "fileInfo" in request body.' });
        return;
    }

    // *** NY: Validera userEmail (grundläggande) ***
     if (!userEmail || typeof userEmail !== 'string' || userEmail.trim() === '') {
        console.error('Invalid or missing userEmail in request body:', request.body);
        // Skicka inte tillbaka e-posten i felmeddelandet för säkerhets skull
        response.status(400).json({ success: false, message: 'Bad Request: Missing or invalid "userEmail" in request body.' });
        return;
    }


    console.log('Received fileInfo:', fileInfo);
    console.log('Received userEmail:', userEmail); // Logga e-post för felsökning

    // 4. Configure Airtable connection using Environment Variables
    const apiKey = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableName = 'Invoices';

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
            'FileWidgetInfo': JSON.stringify(fileInfo, null, 2),
            'Status': 'Pending',
            // *** NY: Lägg till UserEmail till datan som ska sparas ***
            'UserEmail': userEmail
        };

        console.log('Attempting to create Airtable record with data:', dataToSave);

        // 5. Create a new record in the specified table
        const records = await base(tableName).create([
            { fields: dataToSave }
        ]);

        if (!records || records.length === 0) {
            throw new Error('Airtable record creation did not return the expected result.');
        }

        const newRecord = records[0];
        const newRecordId = newRecord.getId();

        console.log(`Successfully created Airtable record. ID: ${newRecordId}`);

        // 8. Send success response back to the frontend
        response.status(200).json({
            success: true,
            invoiceId: newRecordId
        });

    } catch (error) {
        // 7. Handle potential errors during Airtable operation
        console.error('Error interacting with Airtable:', error);
        response.status(500).json({
            success: false,
            message: 'Error saving data to database.',
            // errorDetail: error.message
        });
    }
}
