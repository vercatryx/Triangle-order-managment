'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { MenuItem, MealItem } from '@/lib/types';
import { getItemPoints } from '@/lib/utils';
import { Minus, Plus, Utensils, X } from 'lucide-react';
import TextareaAutosize from 'react-textarea-autosize';
import { createPortal } from 'react-dom';
import styles from './MenuItemCard.module.css';

interface Props {
    item: MenuItem | MealItem;
    quantity: number;
    note?: string;
    onQuantityChange: (newQty: number) => void;
    onNoteChange: (note: string) => void;
    contextLabel?: string; // e.g. "Vendor Name" or "Category"
}

export default function MenuItemCard({
    item,
    quantity,
    note = '',
    onQuantityChange,
    onNoteChange,
    contextLabel
}: Props) {
    const pathname = usePathname();
    const isClientPortal = (pathname ?? '').startsWith('/client-portal');
    const allowNotes = !isClientPortal;

    const [isModalOpen, setIsModalOpen] = React.useState(false);
    const handleIncrement = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        onQuantityChange(quantity + 1);
    };
    const handleDecrement = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        onQuantityChange(Math.max(0, quantity - 1));
    };

    const toggleModal = () => setIsModalOpen(!isModalOpen);

    const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

    const displayPoints = getItemPoints(item);

    return (
        <div className={`${styles.card} ${quantity > 0 ? styles.selected : ''}`} onClick={toggleModal}>
            {/* Image Section: only when item has a real image; icon only as fallback if image fails */}
            {item.imageUrl && (
                <div className={`${styles.imageContainer} ${styles.hasImage}`}>
                    <img
                        src={item.imageUrl}
                        alt={item.name}
                        className={styles.image}
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.parentElement?.classList.add(styles.fallbackActive);
                        }}
                    />
                    <div className={styles.placeholder} aria-hidden>
                        <Utensils size={64} strokeWidth={1.5} />
                    </div>
                </div>
            )}

            {/* Content Section */}
            <div className={styles.content}>
                <div className={styles.header}>
                    <div className={styles.name}>{item.name}</div>
                    <div className={styles.value}>
                        {displayPoints} pts
                    </div>
                </div>

                {contextLabel && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        {contextLabel}
                    </div>
                )}

                {/* Note Input (only if selected, enabled, and not in client portal) */}
                {quantity > 0 && item.notesEnabled && allowNotes && (
                    <TextareaAutosize
                        className={styles.noteInput}
                        minRows={1}
                        placeholder="Add special instructions..."
                        value={note}
                        onClick={stopPropagation}
                        onChange={(e) => onNoteChange(e.target.value)}
                    />
                )}

                {/* Controls */}
                <div className={styles.controls} onClick={stopPropagation}>
                    <div className={styles.qtyGroup}>
                        <button
                            className={styles.qtyBtn}
                            onClick={handleDecrement}
                            disabled={quantity === 0}
                        >
                            <Minus size={14} />
                        </button>
                        <span className={styles.qtyValue}>{quantity}</span>
                        <button
                            className={styles.qtyBtn}
                            onClick={handleIncrement}
                        >
                            <Plus size={14} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Detailed Modal */}
            {isModalOpen && typeof document !== 'undefined' && createPortal(
                <div className={styles.modalOverlay} onClick={toggleModal}>
                    <div className={styles.modalBody} onClick={stopPropagation}>
                        <button className={styles.closeBtn} onClick={toggleModal}>
                            <X size={24} />
                        </button>

                        {item.imageUrl && (
                            <div className={styles.modalImageContainer}>
                                <img src={item.imageUrl} alt={item.name} className={styles.modalImage} />
                            </div>
                        )}

                        <div className={styles.modalContent}>
                            <div className={styles.modalHeader}>
                                <h2 className={styles.modalName}>{item.name}</h2>
                                <div className={styles.modalValue}>{displayPoints} pts</div>
                            </div>

                            {contextLabel && <div className={styles.modalContext}>{contextLabel}</div>}

                            {item.notesEnabled && allowNotes && (
                                <div className={styles.modalNoteSection}>
                                    <label className={styles.modalLabel}>Special Instructions</label>
                                    <TextareaAutosize
                                        className={styles.modalNoteInput}
                                        minRows={3}
                                        placeholder="Add any specific requirements or preferences..."
                                        value={note}
                                        onChange={(e) => onNoteChange(e.target.value)}
                                    />
                                </div>
                            )}

                            <div className={styles.modalControls}>
                                <div className={styles.modalQtyGroup}>
                                    <button
                                        className={styles.modalQtyBtn}
                                        onClick={handleDecrement}
                                        disabled={quantity === 0}
                                    >
                                        <Minus size={20} />
                                    </button>
                                    <span className={styles.modalQtyValue}>{quantity}</span>
                                    <button
                                        className={styles.modalQtyBtn}
                                        onClick={handleIncrement}
                                    >
                                        <Plus size={20} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
