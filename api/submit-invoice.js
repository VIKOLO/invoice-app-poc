// Import the Airtable library
const Airtable = require('airtable');
// Om du stöter på "fetch is not defined" i Vercel-loggar senare, avkommentera nästa rad
// const fetch = require('node-fetch');

export default async function handler(request, response) {

    if (request.method !== 'POST') {
        console.log(`Received non-POST request: ${request.method}`);
        response.setHeader('Allow', ['POST']);
        response.status(405).json({ success: false, message: `Method ${request.method} Not Allowed` });
        return;
    }

    console.log('Received POST request to /api/submit-invoice');

    const { userEmail, fileInfo } = request.body;

    if (!fileInfo || typeof fileInfo !== 'object' || !fileInfo.uuid || !fileInfo.cdnUrl || !fileInfo.name) {
        console.error('Invalid or missing fileInfo:', request.body);
        return response.status(400).json({ success: false, message: 'Bad Request: Missing or invalid "fileInfo".' });
    }
    if (!userEmail || typeof userEmail !== 'string' || userEmail.trim() === '') {
        console.error('Invalid or missing userEmail:', request.body);
        return response.status(400).json({ success: false, message: 'Bad Request: Missing or invalid "userEmail".' });
    }

    console.log('Received fileInfo (first file):', fileInfo);
    console.log('Received userEmail:', userEmail);

    const apiKey = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableName = 'Invoices';

    // *** DEFINIERA DIN N8N PRODUCTION URL HÄR ***
    const N8N_WEBHOOK_URL = 'https://sourceful-energy.app.n8n.cloud/webhook/2e064782-8b88-495e-877e-92989f7f3a8e'; // <--- !!! KLISTRA IN DIN N8N PRODUCTION URL HÄR MELLAN CITATTECKNEN !!!

    // *** Utökad Debugging för N8N_WEBHOOK_URL (nu med korrekta variabelnamn) ***
    console.log(`[DEBUG] N8N_WEBHOOK_URL is currently set to: "${N8N_WEBHOOK_URL}"`);
    const isPlaceholder = N8N_WEBHOOK_URL === 'YOUR_N8N_WEBHOOK_URL_HERE'; // Jämför med en TYDLIG platshållare
    const isActualPlaceholderFromBefore = N8N_WEBHOOK_URL === 'YOUR_N8N_PRODUCTION_URL_SHOULD_GO_HERE'; // Jämför med den nya platshållaren
    const isEmptyOrNull = !N8N_WEBHOOK_URL;
    console.log(`[DEBUG] Is N8N_WEBHOOK_URL the 'YOUR_N8N_WEBHOOK_URL_HERE' placeholder? ${isPlaceholder}`);
    console.log(`[DEBUG] Is N8N_WEBHOOK_URL the 'YOUR_N8N_PRODUCTION_URL_SHOULD_GO_HERE' placeholder? ${isActualPlaceholderFromBefore}`);
    console.log(`[DEBUG] Is N8N_WEBHOOK_URL empty, null, or undefined? ${isEmptyOrNull}`);


    if (!apiKey || !baseId) {
        console.error('Server Config Error: Airtable credentials missing.');
        return response.status(500).json({ success: false, message: 'Server configuration error (Airtable).' });
    }

    let newRecordId = null;

    try {
        Airtable.configure({ apiKey: apiKey });
        const base = Airtable.base(baseId);
        const dataToSave = {
            'FileWidgetInfo': JSON.stringify(fileInfo, null, 2),
            'Status': 'Pending AI',
            'UserEmail': userEmail
        };

        console.log('Attempting to create initial Airtable record:', dataToSave);
        const records = await base(tableName).create([{ fields: dataToSave }]);

        if (!records || records.length === 0) {
            throw new Error('Airtable record creation did not return the expected result.');
        }
        newRecordId = records[0].getId();
        console.log(`Successfully created Airtable record. ID: ${newRecordId}`);

        // Villkor för att anropa webhook
        const shouldTriggerWebhook = N8N_WEBHOOK_URL &&
                                   N8N_WEBHOOK_URL.startsWith('http') &&
                                   N8N_WEBHOOK_URL !== 'YOUR_N8N_WEBHOOK_URL_HERE' &&
                                   N8N_WEBHOOK_URL !== 'YOUR_N8N_PRODUCTION_URL_SHOULD_GO_HERE';

        if (shouldTriggerWebhook) {
            console.log(`Attempting to trigger n8n webhook for record ID: ${newRecordId} to URL: ${N8N_WEBHOOK_URL}`);
            const webhookResponse = await fetch(N8N_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recordId: newRecordId })
            });

            if (!webhookResponse.ok) {
                const errorText = await webhookResponse.text(); // Läs svarstexten vid fel
                console.error(`Error triggering n8n webhook: ${webhookResponse.status} ${webhookResponse.statusText}. Response: ${errorText}`);
                // Fortsätt svara success till frontend, men logga varningen
            } else {
                console.log('Successfully triggered n8n webhook.');
            }
        } else {
            console.warn(`n8n Webhook URL is not properly configured. Current value: "${N8N_WEBHOOK_URL}". Placeholder values are 'YOUR_N8N_WEBHOOK_URL_HERE' or 'YOUR_N8N_PRODUCTION_URL_SHOULD_GO_HERE'. Skipping webhook trigger.`);
        }

        response.status(200).json({
            success: true,
            invoiceId: newRecordId
        });

    } catch (error) {
        console.error('Error in /api/submit-invoice:', error);
        if (newRecordId) {
             response.status(200).json({ success: true, invoiceId: newRecordId, warning: 'Airtable record created, but webhook trigger might have failed or was skipped. Check server logs.' });
        } else {
            response.status(500).json({ success: false, message: 'Error processing request.', errorDetail: error.message });
        }
    }
}
