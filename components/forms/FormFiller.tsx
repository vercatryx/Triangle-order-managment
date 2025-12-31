"use client";

import { useState } from 'react';
import { FormSchema } from '@/lib/form-types';
import { createSubmission } from '@/lib/form-actions';
import { AlertCircle, ArrowLeft, Link as LinkIcon, Copy, Check } from 'lucide-react';
import styles from './FormFiller.module.css';

interface FormFillerProps {
    schema: FormSchema;
    onBack: () => void;
    clientId?: string;
}

export default function FormFiller({ schema, onBack, clientId }: FormFillerProps) {
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reviewLink, setReviewLink] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const handleAnswerChange = (questionId: string, value: string) => {
        setAnswers(prev => ({
            ...prev,
            [questionId]: value
        }));
    };

    const handleCreateLink = async () => {
        setIsGenerating(true);
        setError(null);
        try {
            const result = await createSubmission(answers, clientId);

            if (result.success && result.token) {
                const link = `${window.location.origin}/verify-order/${result.token}`;
                setReviewLink(link);

                // Auto-copy to clipboard
                await navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 3000);
            } else {
                throw new Error(result.error || 'Failed to create submission');
            }

        } catch (err: any) {
            console.error("Submission Error:", err);
            setError(err.message || 'Failed to create review link');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCopyLink = async () => {
        if (reviewLink) {
            await navigator.clipboard.writeText(reviewLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    // Calculate progress
    const totalQuestions = schema.questions.length;
    const answeredCount = Object.keys(answers).length;
    const progress = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0;

    // If link generated, show success state
    if (reviewLink) {
        return (
            <div className={styles.container}>
                <div className={styles.headerCard} style={{ textAlign: 'center', padding: '40px' }}>
                    <Check size={64} color="#10b981" style={{ margin: '0 auto 20px' }} />
                    <h1 className={styles.title}>Review Link Created!</h1>
                    <p className={styles.description}>
                        The form has been saved. Share this link for review and signature.
                    </p>

                    <div style={{
                        margin: '30px 0',
                        padding: '16px',
                        background: 'var(--bg-secondary)',
                        borderRadius: '8px',
                        wordBreak: 'break-all'
                    }}>
                        <code style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                            {reviewLink}
                        </code>
                    </div>

                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                        <button
                            onClick={handleCopyLink}
                            className="btn btn-primary"
                        >
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                            {copied ? 'Copied!' : 'Copy Link'}
                        </button>
                        <button
                            onClick={onBack}
                            className="btn btn-secondary"
                        >
                            <ArrowLeft size={16} />
                            Back to Profile
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Header */}
            <div>
                <button
                    onClick={onBack}
                    className={styles.backButton}
                >
                    <ArrowLeft size={16} />
                    Back
                </button>

                <div className={styles.headerCard}>
                    <h1 className={styles.title}>{schema.title}</h1>
                    <p className={styles.description}>Please complete all fields below.</p>
                </div>
            </div>

            {error && (
                <div className={styles.error}>
                    <AlertCircle size={20} color="#f87171" />
                    {error}
                </div>
            )}

            <div className={styles.formGrid}>
                {schema.questions.map((q, index) => (
                    <div key={q.id} className={styles.questionCard}>
                        <label className={styles.questionLabel}>
                            <span className={styles.questionNumber}>{index + 1}.</span>
                            {q.text}
                        </label>

                        {q.type === 'text' ? (
                            <input
                                type="text"
                                value={answers[q.id] || ''}
                                onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                                className={styles.textInput}
                                placeholder="Your answer"
                            />
                        ) : (
                            <div className={styles.radioGroup}>
                                {q.options?.map((opt, i) => (
                                    <label key={i} className={styles.radioLabel}>
                                        <div className={styles.radioInputWrapper}>
                                            <input
                                                type="radio"
                                                name={q.id}
                                                value={opt}
                                                checked={answers[q.id] === opt}
                                                onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                                                className={styles.radioInput}
                                            />
                                            <div className={styles.radioDot} />
                                        </div>
                                        <span className={answers[q.id] === opt ? styles.optionTextSelected : styles.optionText}>
                                            {opt}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Sticky Action Footer */}
            <div className={styles.stickyFooter}>
                <div className={styles.footerContent}>
                    <div className={styles.progressContainer}>
                        <div className={styles.progressLabels}>
                            <span>Progress</span>
                            <span>{Math.round(progress)}%</span>
                        </div>
                        <div className={styles.track}>
                            <div
                                className={styles.bar}
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>

                    <button
                        onClick={handleCreateLink}
                        disabled={isGenerating}
                        className={styles.submitBtn}
                    >
                        {isGenerating ? (
                            <div className={styles.spinner} />
                        ) : (
                            <>
                                <span>Generate Review Link</span>
                                <LinkIcon size={16} />
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
