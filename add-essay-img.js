const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_KEY';
const supabase = createClient(supabaseUrl, supabaseKey);

async function uploadImageToSupabase(filePath, bucketName = 'essay-images') {
    const fileName = path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);

    const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(fileName, fileBuffer);

    if (error) {
        console.error(`Failed to upload ${fileName}:`, error);
        return null;
    }

    const { publicURL, error: urlError } = supabase.storage
        .from(bucketName)
        .getPublicUrl(fileName);

    if (urlError) {
        console.error(`Failed to get public URL for ${fileName}:`, urlError);
        return null;
    }

    return publicURL;
}

async function uploadAllImages(directoryPath) {
    const imageUrls = [];
    const files = fs.readdirSync(directoryPath);

    for (const file of files) {
        if (file.endsWith('.jpg') || file.endsWith('.png')) {
            const filePath = path.join(directoryPath, file);
            const url = await uploadImageToSupabase(filePath);
            if (url) {
                imageUrls.push(url);
            }
        }
    }

    return imageUrls;
}

// Usage
const imageDirectory = '/path/to/your/screenshots/';
uploadAllImages(imageDirectory)
    .then(urls => {
        console.log('Image URLs:', urls);
    })
    .catch(error => {
        console.error('Error uploading images:', error);
    });