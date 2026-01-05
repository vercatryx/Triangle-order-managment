'use server';

import nodemailer from 'nodemailer';

/**
 * Email configuration for GoDaddy hosted email
 * Set these environment variables:
 * - SMTP_HOST (e.g., smtp.secureserver.net for GoDaddy)
 * - SMTP_PORT (usually 465 for SSL or 587 for TLS)
 * - SMTP_SECURE (true for port 465, false for port 587)
 * - SMTP_USER (your email address)
 * - SMTP_PASS (your email password)
 */

interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    try {
        const host = process.env.SMTP_HOST;
        const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
        const secure = process.env.SMTP_SECURE === 'true' || port === 465;
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;

        // Check if email is configured
        if (!host || !user || !pass) {
            console.warn('Email not configured. Missing SMTP environment variables.');
            return {
                success: false,
                error: 'Email service not configured. Please set SMTP environment variables.'
            };
        }

        // Create transporter
        const transporter = nodemailer.createTransport({
            host,
            port,
            secure,
            auth: {
                user,
                pass
            }
        });

        // Send email with friendly name to hide the email address
        await transporter.sendMail({
            from: `"Triangle Square System" <${user}>`,
            to: options.to,
            subject: options.subject,
            html: options.html,
            text: options.text || options.html.replace(/<[^>]*>/g, '') // Strip HTML for text version
        });

        return { success: true };
    } catch (error: any) {
        console.error('Error sending email:', error);
        return {
            success: false,
            error: error.message || 'Failed to send email'
        };
    }
}

