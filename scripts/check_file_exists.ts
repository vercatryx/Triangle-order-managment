
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

const FILE_KEY = 'signed-order-1768415188917.pdf';

const S3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID || '',
        secretAccessKey: R2_SECRET_ACCESS_KEY || '',
    },
});

async function checkFile() {
    console.log(`Checking for file: ${FILE_KEY} in bucket: ${R2_BUCKET_NAME}`);

    try {
        const command = new HeadObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: FILE_KEY,
        });

        const response = await S3.send(command);
        console.log('SUCCESS: File exists!');
        console.log(`Size: ${response.ContentLength} bytes`);
        console.log(`Last Modified: ${response.LastModified}`);
        console.log(`Content Type: ${response.ContentType}`);
    } catch (error: any) {
        if (error.name === 'NotFound') {
            console.error('FAILURE: File does NOT exist (NotFound).');
        } else {
            console.error('ERROR: Failed to check file:', error);
        }
    }
}

checkFile();
