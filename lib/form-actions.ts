'use server';

import { createClient } from '@supabase/supabase-js';
import { FormSchema, Question, FilledForm, Answer, QuestionType } from './form-types';
import { revalidatePath } from 'next/cache';

// Initialize a supabase client with the Service Role Key to bypass RLS.
// This is crucial for admin actions (saving form) and ensuring public access (getting form) works reliably regardless of RLS complexity.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Use a getter to potentially handle missing key gracefully or throw
const getAdminClient = () => {
    if (!supabaseServiceKey) {
        console.error("SUPABASE_SERVICE_ROLE_KEY is missing. Falling back to anon key, which may fail due to RLS.");
        // Fallback to anon key if service role is missing, though this likely won't work for admin writes if RLS is strict.
        return createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    }
    return createClient(supabaseUrl, supabaseServiceKey);
};

const supabase = getAdminClient();

// --- FORM ACTIONS ---

export async function saveForm(schema: FormSchema) {
    try {
        // 1. Insert Form
        const { data: formData, error: formError } = await supabase
            .from('forms')
            .insert({
                title: schema.title,
                description: 'Created via Form Builder' // We could add a description field later
            })
            .select()
            .single();

        if (formError) throw formError;

        const formId = formData.id;

        // 2. Insert Questions
        const questionsToInsert = schema.questions.map((q, index) => ({
            form_id: formId,
            text: q.text,
            type: q.type,
            options: q.options ? JSON.stringify(q.options) : null,
            "order": index
        }));

        const { error: questionsError } = await supabase
            .from('questions')
            .insert(questionsToInsert);

        if (questionsError) throw questionsError;

        revalidatePath('/forms');
        return { success: true, formId };
    } catch (error: any) {
        console.error('Error saving form:', error);
        return { success: false, error: error.message };
    }
}

export async function getForms() {
    try {
        const { data, error } = await supabase
            .from('forms')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return { success: true, data };
    } catch (error: any) {
        console.error('Error fetching forms:', error);
        return { success: false, error: error.message };
    }
}

export async function getForm(formId: string): Promise<{ success: boolean; data?: FormSchema; error?: string }> {
    try {
        // Fetch form details
        const { data: form, error: formError } = await supabase
            .from('forms')
            .select('*')
            .eq('id', formId)
            .single();

        if (formError) throw formError;

        // Fetch questions
        const { data: questionsData, error: questionsError } = await supabase
            .from('questions')
            .select('*')
            .eq('form_id', formId)
            .order('"order"', { ascending: true }); // Quote "order" because it's a reserved word

        if (questionsError) throw questionsError;

        // Map to FormSchema
        const questions: Question[] = questionsData.map((q: any) => ({
            id: q.id,
            type: q.type,
            text: q.text,
            options: q.options ? JSON.parse(q.options) : undefined
        }));

        return {
            success: true,
            data: {
                id: form.id,
                title: form.title,
                questions
            }
        };

    } catch (error: any) {
        console.error('Error fetching form:', error);
        return { success: false, error: error.message };
    }
}

// --- SUBMISSION ACTIONS ---

export async function submitForm(formId: string, answers: Record<string, string>) {
    try {
        // 1. Create Submission (Filled Form)
        // Note: For public submissions, we might want to allow this even without service role if RLS allows.
        // But using service role ensures it works.
        const { data: submission, error: submissionError } = await supabase
            .from('filled_forms')
            .insert({
                form_id: formId
            })
            .select()
            .single();

        if (submissionError) throw submissionError;

        const submissionId = submission.id;

        // 2. Save Answers
        const answersToInsert = Object.entries(answers).map(([questionId, value]) => ({
            filled_form_id: submissionId,
            question_id: questionId,
            value: value
        }));

        if (answersToInsert.length > 0) {
            const { error: answersError } = await supabase
                .from('form_answers')
                .insert(answersToInsert);

            if (answersError) throw answersError;
        }

        revalidatePath('/forms');
        return { success: true, submissionId };

    } catch (error: any) {
        console.error('Error submitting form:', error);
        return { success: false, error: error.message };
    }
}

const ORDER_FORM_TITLE = "Order Form";

export async function saveSingleForm(questions: any[]) {
    try {
        // 1. Check if the single form exists
        let { data: form } = await supabase
            .from('forms')
            .select('id')
            .eq('title', ORDER_FORM_TITLE)
            .single();

        let formId = form?.id;

        if (!formId) {
            // Create if it doesn't exist
            const { data: newForm, error: createError } = await supabase
                .from('forms')
                .insert({
                    title: ORDER_FORM_TITLE,
                    description: 'Global Order Form'
                })
                .select()
                .single();

            if (createError) throw createError;
            formId = newForm.id;
        }

        // 2. Clear existing questions (full replace strategy)
        const { error: deleteError } = await supabase
            .from('questions')
            .delete()
            .eq('form_id', formId);

        if (deleteError) throw deleteError;

        // 3. Insert new questions
        if (questions.length > 0) {
            const { error: insertError } = await supabase
                .from('questions')
                .insert(
                    questions.map((q, index) => ({
                        form_id: formId,
                        text: q.text,
                        type: q.type,
                        options: q.options ? JSON.stringify(q.options) : null,
                        order: index
                    }))
                );

            if (insertError) throw insertError;
        }

        revalidatePath('/forms');
        return { success: true, formId };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getSingleForm() {
    try {
        const { data: form, error: formError } = await supabase
            .from('forms')
            .select('id, title, description')
            .eq('title', ORDER_FORM_TITLE)
            .single();

        if (formError) {
            if (formError.code === 'PGRST116') {
                // No rows found, return null (not an error, just empty)
                return { success: true, data: null };
            }
            throw formError;
        }

        const { data: questions, error: qError } = await supabase
            .from('questions')
            .select('*')
            .eq('form_id', form.id)
            .order('order', { ascending: true });

        if (qError) throw qError;

        const schema: FormSchema = {
            id: form.id,
            title: form.title,
            questions: questions.map((q: any) => ({ // Explicit typing to fix implicit any
                id: q.id,
                type: q.type as QuestionType,
                text: q.text,
                options: q.options ? JSON.parse(q.options as unknown as string) : undefined
            }))
        };

        return { success: true, data: schema };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

// --- FILE STORAGE (R2) ---

import { uploadFile } from './storage';

export async function uploadFormPdf(formData: FormData) {
    try {
        const file = formData.get('file') as File;
        if (!file) {
            throw new Error('No file provided');
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const timestamp = new Date().getTime();
        const filename = `order-form-${timestamp}.pdf`; // Simple unique key

        const { success, key } = await uploadFile(filename, buffer, 'application/pdf');

        if (!success) {
            throw new Error('Upload failed');
        }

        return { success: true, key };
    } catch (error: any) {
        console.error('Error uploading PDF:', error);
        return { success: false, error: error.message };
    }
}

// --- SUBMISSION MANAGEMENT (Verification Flow) ---

export async function createSubmission(data: Record<string, string>, clientId?: string) {
    try {
        // Get the Order Form ID
        const formResult = await getSingleForm();
        if (!formResult.success || !formResult.data) {
            throw new Error('Order Form not found');
        }

        const { data: submission, error } = await supabase
            .from('form_submissions')
            .insert({
                form_id: formResult.data.id,
                client_id: clientId || null,
                status: 'pending',
                data: data
            })
            .select()
            .single();

        if (error) throw error;

        // Set screening status to waiting_approval when form is submitted
        if (clientId) {
            const { error: updateError } = await supabase
                .from('clients')
                .update({ screening_status: 'waiting_approval' })
                .eq('id', clientId);

            if (updateError) {
                console.error('Failed to update screening status:', updateError);
                // Don't fail the submission if this fails
            }
        }

        return { success: true, token: submission.token, submissionId: submission.id };
    } catch (error: any) {
        console.error('Error creating submission:', error);
        return { success: false, error: error.message };
    }
}

export async function getSubmissionByToken(token: string) {
    try {
        const { data: submission, error } = await supabase
            .from('form_submissions')
            .select('*')
            .eq('token', token)
            .single();

        if (error) throw error;

        // Also fetch the form schema
        const formResult = await getForm(submission.form_id);
        if (!formResult.success || !formResult.data) {
            throw new Error('Form not found');
        }

        return {
            success: true,
            data: {
                submission,
                formSchema: formResult.data
            }
        };
    } catch (error: any) {
        console.error('Error fetching submission:', error);
        return { success: false, error: error.message };
    }
}

export async function updateSubmissionStatus(token: string, status: 'accepted' | 'rejected', signatureDataUrl?: string, comments?: string) {
    try {
        let signatureUrl = null;

        // If signature provided, upload it
        if (signatureDataUrl && status === 'accepted') {
            const base64Data = signatureDataUrl.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            const timestamp = new Date().getTime();
            const filename = `signature-${timestamp}.png`;

            const { success, key } = await uploadFile(filename, buffer, 'image/png');
            if (success) {
                signatureUrl = key;
            }
        }

        const updateData: any = { status };
        if (signatureUrl) {
            updateData.signature_url = signatureUrl;
        }
        if (comments) {
            updateData.comments = comments;
        }

        const { data: updatedSubmission, error } = await supabase
            .from('form_submissions')
            .update(updateData)
            .eq('token', token)
            .select('client_id')
            .single();

        if (error) throw error;

        // Update client screening_status based on submission status
        if (updatedSubmission?.client_id) {
            const newScreeningStatus = status === 'accepted' ? 'approved' : 'rejected';
            const { error: clientUpdateError } = await supabase
                .from('clients')
                .update({ screening_status: newScreeningStatus })
                .eq('id', updatedSubmission.client_id);

            if (clientUpdateError) {
                console.error('Failed to update client screening status:', clientUpdateError);
                // Don't fail the submission if this fails
            }
        }

        return { success: true };
    } catch (error: any) {
        console.error('Error updating submission status:', error);
        return { success: false, error: error.message };
    }
}

export async function finalizeSubmission(token: string, pdfBlob: Blob) {
    try {
        const buffer = Buffer.from(await pdfBlob.arrayBuffer());
        const timestamp = new Date().getTime();
        const filename = `signed-order-${timestamp}.pdf`;

        const { success, key } = await uploadFile(filename, buffer, 'application/pdf');

        if (!success) {
            throw new Error('PDF upload failed');
        }

        const { error } = await supabase
            .from('form_submissions')
            .update({ pdf_url: key })
            .eq('token', token);

        if (error) throw error;

        return { success: true, pdfUrl: key };
    } catch (error: any) {
        console.error('Error finalizing submission:', error);
        return { success: false, error: error.message };
    }
}

export async function getClientSubmissions(clientId: string) {
    try {
        const { data, error } = await supabase
            .from('form_submissions')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return { success: true, data };
    } catch (error: any) {
        console.error('Error fetching client submissions:', error);
        return { success: false, error: error.message };
    }
}
