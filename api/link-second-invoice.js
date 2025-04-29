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

    console.log('Received POST request to /api/link-second-invoice');

    // 2. Read and validate request body
    const { originalInvoiceId, secondFileInfo } = request.body;

    // Validate originalInvoiceId
    if (!originalInvoiceId || typeof originalInvoiceId !== 'string' || !originalInvoiceId.startsWith('rec')) {
        console.error('Invalid or missing originalInvoiceId:', originalInvoiceId);
        return response.status(400).json({ success: false, message: 'Bad Request: Missing or invalid "originalInvoiceId".' });
    }

    // Validate secondFileInfo
    if (!secondFileInfo || typeof secondFileInfo !== 'object' ||
        !secondFileInfo.uuid || !secondFileInfo.cdnUrl || !secondFileInfo.name) {
        console.error('Invalid or missing secondFileInfo:', secondFileInfo);
        return response.status(400).json({ success: false, message: 'Bad Request: Missing or invalid "secondFileInfo" object (must include uuid, cdnUrl, name).' });
    }

    console.log(`Linking second file to Record ID: ${originalInvoiceId}`);
    console.log('Second file info:', secondFileInfo);

    // 4. Configure Airtable connection using Environment Variables
    const apiKey = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableName = 'Invoices'; // Your specific table name

    if (!apiKey || !baseId) {
        console.error('Server Configuration Error: Missing Airtable credentials in environment variables.');
        return response.status(500).json({ success: false, message: 'Server configuration error.' });
    }

    try {
        // 5. Prepare Airtable Update Payload
        // We only want to update the field storing the second file's info
        const fieldsToUpdate = {
            // Assuming your new Airtable field is named exactly 'FileWidgetInfo_Second'
            'FileWidgetInfo_Second': JSON.stringify(secondFileInfo, null, 2), // Store as stringified JSON
        };

        console.log(`Attempting to update Airtable record ${originalInvoiceId} with data:`, fieldsToUpdate);

        // Initialize Airtable connection
        Airtable.configure({ apiKey: apiKey });
        const base = Airtable.base(baseId);

        // 6. Update the existing Airtable Record
        // Airtable's update method expects an array of records to update
        await base(tableName).update([
            {
                "id": originalInvoiceId,
                "fields": fieldsToUpdate
            }
        ]);

        console.log(`Successfully updated Airtable record ${originalInvoiceId} with second file info.`);

        // 8. Send success response back to the frontend
        response.status(200).json({ success: true });

    } catch (error) {
        // 7. Handle potential errors during Airtable update
        console.error(`Error updating Airtable record ${originalInvoiceId}:`, error);

        // Check for specific Airtable error types if possible
        if (error.statusCode === 404 || error.message?.includes('NOT_FOUND')) {
             console.error(`Record ${originalInvoiceId} not found for update.`);
             // 404 might be appropriate if the ID was invalid from the start
             response.status(404).json({
                 success: false,
                 message: `Error updating database: Record with ID ${originalInvoiceId} not found.`
             });
        } else if (error.statusCode === 422 && error.message?.includes('UNKNOWN_FIELD_NAME')) {
             // This likely means the 'FileWidgetInfo_Second' field name is wrong or missing in Airtable
             console.error(`Field "FileWidgetInfo_Second" likely missing or misspelled in Airtable table "${tableName}". Error: ${error.message}`);
              response.status(400).json({ // 400 Bad Request because the target field is wrong in the database schema
                 success: false,
                 message: 'Error updating database: Target field for second file info not found in Airtable. Check field name "FileWidgetInfo_Second".'
             });
        }
        else {
            // General internal server error for other issues
             response.status(500).json({
                 success: false,
                 message: 'Error updating database record.',
                 // errorDetail: error.message // Be cautious exposing too much detail
             });
        }
    }
}