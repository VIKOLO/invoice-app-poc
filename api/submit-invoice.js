// Import the Airtable library
const Airtable = require('airtable');
// Importera fetch om du använder en äldre Node.js-version på Vercel (behövs ej för >=18)
// const fetch = require('node-fetch'); // Ta bort kommentaren om du får 'fetch is not defined'

// This is the main function Vercel will run
export default async function handler(request, response) {

    if (request.method !== 'POST') {
        console.log(`Received non-POST request: ${request.method}`);
        response.setHeader('Allow', ['POST']);
        response.status(405).json({ success: false, message: `Method ${request.method} Not Allowed` });
        return;
    }

    console.log('Received POST request to /api/submit-invoice');

    const { userEmail, fileInfo } = request.body; // fileInfo är den första filen
    // secondFileInfo kommer från ett separat anrop till /api/link-second-invoice, så hanteras inte här direkt.

    if (!fileInfo || typeof fileInfo !== 'object' || !fileInfo.uuid || !fileInfo.cdnUrl || !fileInfo.name) {
        console.error('Invalid or missing fileInfo in request body:', request.body);
        return response.status(400).json({ success: false, message: 'Bad Request: Missing or invalid "fileInfo".' });
    }
    if (!userEmail || typeof userEmail !== 'string' || userEmail.trim() === '') {
        console.error('Invalid or missing userEmail in request body:', request.body);
        return response.status(400).json({ success: false, message: 'Bad Request: Missing or invalid "userEmail".' });
    }

    console.log('Received fileInfo (first file):', fileInfo);
    console.log('Received userEmail:', userEmail);

    const apiKey = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableName = 'Invoices';
    // *** PLATSHÅLLARE FÖR DIN N8N WEBHOOK URL ***
    const N8N_WEBHOOK_URL = 'https://sourceful-energy.app.n8n.cloud/webhook/2e064782-8b88-495e-877e-92989f7f3a8e';

    if (!apiKey || !baseId) {
        console.error('Server Config Error: Airtable credentials missing.');
        return response.status(500).json({ success: false, message: 'Server configuration error (Airtable).' });
    }
    if (N8N_WEBHOOK_URL === 'https://sourceful-energy.app.n8n.cloud/webhook/2e064782-8b88-495e-877e-92989f7f3a8e' || !N8N_WEBHOOK_URL) {
        console.error('Server Config Error: n8n Webhook URL not configured.');
        // Svara frontend att det gick bra att skapa posten, men logga felet
        // Alternativt, svara med ett fel här om webhook-anropet är kritiskt.
        // För nu, låt oss fortsätta skapa Airtable-posten och bara logga detta.
    }

    let newRecordId = null;

    try {
        // 1. Skapa initial rad i Airtable
        Airtable.configure({ apiKey: apiKey });
        const base = Airtable.base(baseId);
        const dataToSave = {
            'FileWidgetInfo': JSON.stringify(fileInfo, null, 2),
            'Status': 'Pending AI', // Ny status
            'UserEmail': userEmail
            // FileWidgetInfo_Second kommer att läggas till av /api/link-second-invoice
        };

        console.log('Attempting to create initial Airtable record:', dataToSave);
        const records = await base(tableName).create([{ fields: dataToSave }]);

        if (!records || records.length === 0) {
            throw new Error('Airtable record creation did not return the expected result.');
        }
        newRecordId = records[0].getId();
        console.log(`Successfully created Airtable record. ID: ${newRecordId}`);

        // 2. Trigga n8n Webhook om URL är konfigurerad
        if (N8N_WEBHOOK_URL && N8N_WEBHOOK_URL !== 'YOUR_N8N_WEBHOOK_URL_HERE') {
            console.log(`Attempting to trigger n8n webhook for record ID: ${newRecordId}`);
            const webhookResponse = await fetch(N8N_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recordId: newRecordId })
            });

            if (!webhookResponse.ok) {
                // Logga felet men svara ändå success till frontend eftersom Airtable-posten skapades
                console.error(`Error triggering n8n webhook: ${webhookResponse.status} ${webhookResponse.statusText}`, await webhookResponse.text());
                // Du kan välja att hantera detta mer robust, t.ex. försöka igen senare
            } else {
                console.log('Successfully triggered n8n webhook.');
            }
        } else {
            console.warn('n8n Webhook URL not configured. Skipping webhook trigger.');
        }

        // 3. Svara frontend
        response.status(200).json({
            success: true,
            invoiceId: newRecordId
        });

    } catch (error) {
        console.error('Error in /api/submit-invoice:', error);
        // Om ett ID skapades men webhooken misslyckades, vill vi fortfarande skicka tillbaka ID:t
        if (newRecordId) {
             response.status(200).json({
                 success: true, // Airtable-posten skapades
                 invoiceId: newRecordId,
                 warning: 'Webhook trigger might have failed. Check server logs.'
             });
        } else {
            response.status(500).json({
                success: false,
                message: 'Error processing request.',
                errorDetail: error.message
            });
        }
    }
}
