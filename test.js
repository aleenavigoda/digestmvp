async function(properties, context) {
    const admin = require('firebase-admin');

    // Initialize Firebase Admin SDK
    function initializeFirebaseAdmin() {
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: context.keys.firebaseProjectId,
                    clientEmail: context.keys.firebaseClientEmail,
                    privateKey: context.keys.firebasePrivateKey.replace(/\\n/g, '\n')
                })
            });
        }
    }

    // Initialize Firebase
    initializeFirebaseAdmin();

    // Check if recipientToken is provided
    if (!properties.recipientToken) {
        console.error('Recipient token is missing');
        return {
            success: false,
            error: 'Recipient token is required'
        };
    }

    // Prepare the message
    const message = {
        notification: {
            title: properties.title,
            body: properties.body
        },
        token: properties.recipientToken  // Ensure this is correctly set
    };

    // Optional: add data payload if provided
    if (properties.dataPayload) {
        try {
            message.data = JSON.parse(properties.dataPayload);
        } catch (error) {
            console.error('Error parsing data payload:', error);
            return {
                success: false,
                error: 'Invalid data payload format'
            };
        }
    }

    try {
        // Send the message
        const response = await admin.messaging().send(message);
        console.log('FCM message sent successfully:', response);
        return {
            success: true,
            messageId: response
        };
    } catch (error) {
        console.error('Error sending FCM message:', error);
        return {
            success: false,
            error: error.message
        };
    }
}