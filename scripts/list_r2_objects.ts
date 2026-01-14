
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

console.log('--- R2 Bucket Inspection ---');
console.log(`Bucket Name: ${R2_BUCKET_NAME}`);
console.log(`Account ID: ${R2_ACCOUNT_ID}`);

if (!R2_BUCKET_NAME || !R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.error('ERROR: Missing R2 environment variables.');
    process.exit(1);
}

const S3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});

async function listObjects() {
    try {
        const command = new ListObjectsV2Command({
            Bucket: R2_BUCKET_NAME,
            MaxKeys: 20, // List top 20
        });

        const response = await S3.send(command);

        console.log(`\nObjects in bucket '${R2_BUCKET_NAME}' (first 20):`);
        if (!response.Contents || response.Contents.length === 0) {
            console.log('(Bucket is empty or no objects found)');
        } else {
            response.Contents.forEach((obj) => {
                console.log(`- ${obj.Key} (Size: ${obj.Size} bytes, LastModified: ${obj.LastModified})`);
            });
        }

        // specifically check for the file in question
        const specificFile = 'signed-order-1768415188917.pdf';
        const found = response.Contents?.find(obj => obj.Key === specificFile);
        if (found) {
            console.log(`\n[MATCH FOUND] File '${specificFile}' exists in the bucket.`);
        } else {
            console.log(`\n[NO MATCH] File '${specificFile}' does NOT exist in the first 20 items.`);
        }

    } catch (error) {
        console.error('ERROR: Failed to list objects:', error);
    }
}

listObjects();
