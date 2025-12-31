import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

const S3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID || '',
        secretAccessKey: R2_SECRET_ACCESS_KEY || '',
    },
});

export async function uploadFile(key: string, body: Buffer | Uint8Array, contentType: string) {
    if (!R2_BUCKET_NAME) {
        throw new Error('R2_BUCKET_NAME is not defined');
    }

    const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType,
    });

    try {
        await S3.send(command);
        // Construct the public URL (if the bucket is public) or a signed URL (not implemented here yet)
        // For R2, if public access is enabled or a custom domain is set up:
        // return `https://<custom-domain>/${key}`;
        // For now, we'll return a success indicator as the primary goal is ensuring it's saved.
        return { success: true, key };
    } catch (error) {
        console.error('Error uploading to R2:', error);
        throw error;
    }
}
