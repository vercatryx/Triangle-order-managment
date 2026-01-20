'use client';

import { useState, useEffect } from 'react';
import { ItemCategory, MenuItem } from '@/lib/types';
import { addCategory, updateCategory, deleteCategory, addMenuItem, updateMenuItem, deleteMenuItem, uploadMenuItemImage, updateMenuItemOrder, updateCategoryOrder } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Plus, Edit2, Trash2, X, Check, Package, Image as ImageIcon, Upload, Loader2, GripVertical } from 'lucide-react';
import styles from './BoxTypeManagement.module.css';
import ReactCrop, { Crop, PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import getCroppedImg from '@/lib/canvasUtils';

export function BoxCategoriesManagement() {
    const { getCategories, getMenuItems, invalidateReferenceData } = useDataCache();
    const [categories, setCategories] = useState<ItemCategory[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

    // Category Creation
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategorySetValue, setNewCategorySetValue] = useState<string>('');

    // Category Editing
    const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
    const [tempCategoryName, setTempCategoryName] = useState('');
    const [tempCategorySetValue, setTempCategorySetValue] = useState<string>('');

    // Item Creation/Editing (Modal)
    const [isEditingItem, setIsEditingItem] = useState(false);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

    const [itemForm, setItemForm] = useState<Partial<MenuItem>>({
        name: '',
        quotaValue: 1,
        priceEach: 0,
        imageUrl: null,
        sortOrder: 0,
        notesEnabled: false
    });

    // Image Upload State
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
    const [imgRef, setImgRef] = useState<HTMLImageElement | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [showCropper, setShowCropper] = useState(false);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        const [cData, mData] = await Promise.all([getCategories(), getMenuItems()]);
        setCategories(cData);
        setMenuItems(mData);
    }

    // --- CATEGORY ACTIONS ---
    async function handleAddCategory() {
        if (!newCategoryName.trim()) return;
        const setValue = newCategorySetValue.trim() === '' ? null : parseFloat(newCategorySetValue);
        if (setValue !== null && (isNaN(setValue) || setValue <= 0)) {
            alert('Set value must be a positive number or empty');
            return;
        }
        await addCategory(newCategoryName, setValue);
        invalidateReferenceData();
        const cData = await getCategories();
        setCategories(cData);
        setIsAddingCategory(false);
        setNewCategoryName('');
        setNewCategorySetValue('');
    }

    async function handleDeleteCategory(id: string) {
        const hasItems = menuItems.some(i => i.categoryId === id && (i.vendorId === null || i.vendorId === ''));
        if (hasItems) {
            alert('Cannot delete category with items. Remove items first.');
            return;
        }
        if (confirm('Delete this category?')) {
            await deleteCategory(id);
            invalidateReferenceData();
            const cData = await getCategories();
            setCategories(cData);
        }
    }

    async function handleUpdateCategory() {
        if (!editingCategoryId || !tempCategoryName.trim()) return;
        const setValue = tempCategorySetValue.trim() === '' ? null : parseFloat(tempCategorySetValue);
        if (setValue !== null && (isNaN(setValue) || setValue <= 0)) {
            alert('Set value must be a positive number or empty');
            return;
        }
        await updateCategory(editingCategoryId, tempCategoryName, setValue);
        invalidateReferenceData();
        const cData = await getCategories();
        setCategories(cData);
        setEditingCategoryId(null);
    }

    // --- ITEM ACTIONS (MODAL) ---
    function openAddItem(categoryId: string) {
        setActiveCategoryId(categoryId);
        setEditingItemId(null);
        setItemForm({ name: '', quotaValue: 1, priceEach: 0, imageUrl: null, sortOrder: 0, notesEnabled: false });
        setIsEditingItem(true);
        setImageSrc(null);
        setCompletedCrop(null);
    }

    function openEditItem(item: MenuItem) {
        setActiveCategoryId(item.categoryId || null);
        setEditingItemId(item.id);
        setItemForm({ ...item, priceEach: item.priceEach || 0 });
        setIsEditingItem(true);
        setImageSrc(null);
        setCompletedCrop(null);
    }

    async function handleSaveItem() {
        if (!activeCategoryId || !itemForm.name) return;

        if (editingItemId) {
            await updateMenuItem(editingItemId, {
                name: itemForm.name,
                quotaValue: itemForm.quotaValue,
                priceEach: (itemForm.priceEach || 0) > 0 ? itemForm.priceEach : undefined,
                imageUrl: itemForm.imageUrl,
                sortOrder: itemForm.sortOrder,
                notesEnabled: itemForm.notesEnabled
            });
        } else {
            await addMenuItem({
                vendorId: '', // Box items are universal
                name: itemForm.name!,
                value: 0,
                isActive: true,
                categoryId: activeCategoryId,
                quotaValue: itemForm.quotaValue || 1,
                priceEach: (itemForm.priceEach || 0) > 0 ? itemForm.priceEach : undefined,
                imageUrl: itemForm.imageUrl,
                sortOrder: itemForm.sortOrder,
                notesEnabled: itemForm.notesEnabled
            });
        }
        invalidateReferenceData();
        const mData = await getMenuItems();
        setMenuItems(mData);
        setIsEditingItem(false);
    }

    async function handleDeleteItem(id: string) {
        if (confirm('Remove this item?')) {
            await deleteMenuItem(id);
            invalidateReferenceData();
            const mData = await getMenuItems();
            setMenuItems(mData);
        }
    }


    // Get box items (items without a vendorId)
    function getBoxItemsForCategory(categoryId: string) {
        return menuItems
            .filter(i => i.categoryId === categoryId && (i.vendorId === null || i.vendorId === ''))
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    }

    // --- IMAGE UPLOAD LOGIC ---
    function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
        const { width, height } = e.currentTarget;
        const crop = centerCrop(
            { unit: '%', width: 90, height: 80 },
            width,
            height
        );
        setCrop(crop);
        setImgRef(e.currentTarget);
        setCompletedCrop(convertToPixelCrop(crop, width, height));
    }

    function convertToPixelCrop(crop: Crop, imageWidth: number, imageHeight: number): PixelCrop {
        return {
            unit: 'px',
            x: (crop.x / 100) * imageWidth,
            y: (crop.y / 100) * imageHeight,
            width: (crop.width / 100) * imageWidth,
            height: (crop.height / 100) * imageHeight,
        };
    }

    const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.addEventListener('load', () => {
                setImageSrc(reader.result?.toString() || '');
                setShowCropper(true);
            });
            reader.readAsDataURL(file);
        }
    };

    const handleUploadImage = async () => {
        if (!imageSrc || !completedCrop) return;
        setIsUploading(true);
        try {
            const finalCrop = completedCrop.unit === 'px' ? completedCrop : convertToPixelCrop(completedCrop, imgRef?.width || 0, imgRef?.height || 0);
            const blob = await getCroppedImg(imageSrc, finalCrop);
            if (!blob) throw new Error('Failed to crop');
            const file = new File([blob], "box-item.jpg", { type: "image/jpeg" });
            const formData = new FormData();
            formData.append('file', file);
            const result = await uploadMenuItemImage(formData);
            if (result.success) {
                setItemForm(prev => ({ ...prev, imageUrl: result.url }));
                setShowCropper(false);
                setImageSrc(null);
            }
        } catch (e) {
            console.error(e);
            alert('Upload failed');
        } finally {
            setIsUploading(false);
        }
    };

    // --- DRAG AND DROP HANDLERS ---
    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;
        if (active.id === over.id) return;

        // Check if dragging Category or Item
        const isCategory = categories.some(c => c.id === active.id);

        if (isCategory) {
            const oldIndex = categories.findIndex(c => c.id === active.id);
            const newIndex = categories.findIndex(c => c.id === over.id);
            if (oldIndex === -1 || newIndex === -1) return;

            const reordered = arrayMove(categories, oldIndex, newIndex);

            const updates = reordered.map((cat, index) => ({
                id: cat.id,
                sortOrder: index
            }));

            // Optimistic
            const newCategories = categories.map(cat => {
                const update = updates.find(u => u.id === cat.id);
                return update ? { ...cat, sortOrder: update.sortOrder } : cat;
            });
            setCategories(newCategories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));

            await updateCategoryOrder(updates);
            invalidateReferenceData();

        } else {
            // Item
            const activeItem = menuItems.find(i => i.id === active.id);
            const overItem = menuItems.find(i => i.id === over.id);

            if (!activeItem || !overItem) return;
            if (activeItem.categoryId !== overItem.categoryId) return; // Restrict to same category

            // Filter items for this category to determine indices
            const catItems = getBoxItemsForCategory(activeItem.categoryId || '');
            const oldIndex = catItems.findIndex(i => i.id === active.id);
            const newIndex = catItems.findIndex(i => i.id === over.id);

            if (oldIndex === -1 || newIndex === -1) return;

            const reordered = arrayMove(catItems, oldIndex, newIndex);
            const updates = reordered.map((item, index) => ({
                id: item.id,
                sortOrder: index
            }));

            // Optimistic Update
            const newMenuItems = menuItems.map(item => {
                const update = updates.find(u => u.id === item.id);
                return update ? { ...item, sortOrder: update.sortOrder } : item;
            });
            setMenuItems(newMenuItems);

            await updateMenuItemOrder(updates);
            invalidateReferenceData();
        }
    };

    // --- COMPONENTS ---

    function SortableCategoryRow({ cat }: { cat: ItemCategory }) {
        const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id });
        const style = {
            transform: CSS.Transform.toString(transform),
            transition,
            zIndex: isDragging ? 100 : 'auto',
            opacity: isDragging ? 0.5 : 1,
            background: 'var(--bg-surface-hover)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-color)'
        };

        const catItems = getBoxItemsForCategory(cat.id);

        return (
            <div ref={setNodeRef} style={style}>
                {/* Category Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    {editingCategoryId === cat.id ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <input
                                    className="input"
                                    value={tempCategoryName}
                                    onChange={e => setTempCategoryName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleUpdateCategory()}
                                    style={{ fontSize: '1rem', fontWeight: 600, flex: 1 }}
                                    autoFocus
                                />
                                <input
                                    type="number"
                                    className="input"
                                    placeholder="Set Value"
                                    value={tempCategorySetValue}
                                    onChange={e => setTempCategorySetValue(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleUpdateCategory()}
                                    min="0.01" step="0.01" style={{ width: '120px' }}
                                />
                                <button onClick={handleUpdateCategory} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-success)' }} title="Save"><Check size={18} /></button>
                                <button onClick={() => setEditingCategoryId(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }} title="Cancel"><X size={18} /></button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <div {...attributes} {...listeners} style={{ cursor: 'grab', display: 'flex', alignItems: 'center', color: '#aaa' }}>
                                    <GripVertical size={16} />
                                </div>
                                <Package size={18} style={{ color: 'var(--color-primary)' }} />
                                <span style={{ fontWeight: 600, fontSize: '1rem' }}>{cat.name}</span>
                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                                    ({catItems.length} items)
                                </span>
                                {cat.setValue !== undefined && cat.setValue !== null && (
                                    <span style={{
                                        color: '#000000',
                                        fontSize: '0.75rem', fontWeight: 600, background: 'var(--color-primary)',
                                        padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(0,0,0,0.1)'
                                    }}>
                                        Set Value: {cat.setValue}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                                <button onClick={() => {
                                    setEditingCategoryId(cat.id);
                                    setTempCategoryName(cat.name);
                                    setTempCategorySetValue(cat.setValue?.toString() || '');
                                }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-primary)' }} title="Edit Category"><Edit2 size={16} /></button>
                                <button onClick={() => handleDeleteCategory(cat.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-danger)' }} title="Delete Category"><Trash2 size={16} /></button>
                            </div>
                        </>
                    )}
                </div>

                {/* Items in Category */}
                <div style={{ padding: '0.5rem', background: 'var(--bg-app)', borderRadius: '4px' }}>
                    <SortableContext
                        items={catItems.map(i => i.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            {catItems.map(item => (
                                <SortableItemRow key={item.id} item={item} />
                            ))}
                            {catItems.length === 0 && (
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No items in this category yet.</span>
                            )}
                        </div>
                    </SortableContext>

                    <button
                        onClick={() => openAddItem(cat.id)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                        <Plus size={14} /> Add Item
                    </button>
                </div>
            </div>
        );
    }

    function SortableItemRow({ item }: { item: MenuItem }) {
        const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
        const style = {
            transform: CSS.Transform.toString(transform),
            transition,
            opacity: isDragging ? 0.5 : 1,
            zIndex: isDragging ? 101 : 'auto',
            display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--bg-surface)', padding: '12px 16px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '1.1rem'
        };

        return (
            <div ref={setNodeRef} style={style}>
                <div {...attributes} {...listeners} style={{ cursor: 'grab', display: 'flex', alignItems: 'center', color: '#aaa', marginRight: '4px' }}>
                    <GripVertical size={14} />
                </div>
                {item.imageUrl && (
                    <img src={item.imageUrl} alt="" style={{ width: '40px', height: '40px', borderRadius: '4px', objectFit: 'cover' }} />
                )}
                <span>{item.name}</span>
                <span style={{ color: 'var(--text-tertiary)' }}>(x{typeof item.quotaValue === 'number' && item.quotaValue % 1 !== 0 ? item.quotaValue.toFixed(2) : (item.quotaValue || 1)})</span>
                {item.priceEach !== undefined && item.priceEach !== null && (
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>${item.priceEach.toFixed(2)}</span>
                )}

                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                    <button onClick={() => openEditItem(item)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-primary)', padding: 0 }} title="Edit Item">
                        <Edit2 size={12} />
                    </button>
                    <button onClick={() => handleDeleteItem(item.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-danger)', padding: 0 }} title="Delete Item">
                        <X size={12} />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container} style={{ display: 'block' }}>
            <div className={styles.header}>
                <div>
                    <h2 className={styles.title}>Box Categories & Items</h2>
                    <p className={styles.subtitle}>Configure categories and items for box service.</p>
                </div>
                <button
                    className="btn btn-primary"
                    onClick={() => setIsAddingCategory(true)}
                >
                    <Plus size={16} /> Add Category
                </button>
            </div>

            {/* Add Category Form */}
            {isAddingCategory && (
                <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg-surface-hover)', borderRadius: '6px', border: '1px solid var(--color-primary)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <input
                                className="input"
                                placeholder="Category Name (e.g., Fruits, Dairy, Proteins)"
                                value={newCategoryName}
                                onChange={e => setNewCategoryName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                                autoFocus
                                style={{ flex: 1 }}
                            />
                            <input
                                type="number"
                                className="input"
                                placeholder="Set Value (optional)"
                                value={newCategorySetValue}
                                onChange={e => setNewCategorySetValue(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                                min="0.01"
                                step="0.01"
                                style={{ width: '120px' }}
                                title="Required quota value - users must select items that sum to exactly this value"
                            />
                            <button className="btn btn-primary" onClick={handleAddCategory}>
                                <Check size={16} /> Save
                            </button>
                            <button className="btn btn-secondary" onClick={() => { setIsAddingCategory(false); setNewCategoryName(''); setNewCategorySetValue(''); }}>
                                <X size={16} /> Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Categories List */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {categories.length === 0 && !isAddingCategory && (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontStyle: 'italic', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
                            No categories yet. Add a category to start configuring box items.
                        </div>
                    )}

                    <SortableContext
                        items={categories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map(c => c.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        {categories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map(cat => (
                            <SortableCategoryRow key={cat.id} cat={cat} />
                        ))}
                    </SortableContext>
                </div>
            </DndContext>

            {/* ITEM MODAL */}
            {isEditingItem && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div style={{ background: 'var(--bg-surface)', padding: '20px', borderRadius: '8px', width: '500px', maxWidth: '90%', border: '1px solid var(--border-color)' }}>
                        <h3 style={{ marginBottom: '16px' }}>{editingItemId ? 'Edit Item' : 'New Item'}</h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                                <label className="label">Name</label>
                                <input className="input" value={itemForm.name} onChange={e => setItemForm({ ...itemForm, name: e.target.value })} autoFocus />
                            </div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <div style={{ flex: 1 }}>
                                    <label className="label">Quota Value</label>
                                    <input type="number" className="input" value={itemForm.quotaValue} onChange={e => setItemForm({ ...itemForm, quotaValue: Number(e.target.value) })} min="1" />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label className="label">Price ($)</label>
                                    <input type="number" className="input" value={itemForm.priceEach} onChange={e => setItemForm({ ...itemForm, priceEach: Number(e.target.value) })} step="0.01" />
                                </div>
                            </div>
                            <div>
                                <label className="label">Sort Order</label>
                                <input type="number" className="input" value={itemForm.sortOrder} onChange={e => setItemForm({ ...itemForm, sortOrder: Number(e.target.value) })} />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                    type="checkbox"
                                    id="notesEnabled"
                                    checked={itemForm.notesEnabled}
                                    onChange={e => setItemForm({ ...itemForm, notesEnabled: e.target.checked })}
                                />
                                <label htmlFor="notesEnabled" className="label" style={{ marginBottom: 0, cursor: 'pointer' }}>Enable Notes</label>
                            </div>

                            {/* IMAGE UPLOADER */}
                            <div>
                                <label className="label">Image</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    {itemForm.imageUrl ? (
                                        <div style={{ width: '60px', height: '60px', position: 'relative' }}>
                                            <img src={itemForm.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }} />
                                            <button onClick={() => setItemForm({ ...itemForm, imageUrl: null })} style={{ position: 'absolute', top: -5, right: -5, background: 'red', color: 'white', borderRadius: '50%', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}><X size={10} /></button>
                                        </div>
                                    ) : (
                                        <div style={{ width: '60px', height: '60px', background: '#333', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <ImageIcon size={20} color="#666" />
                                        </div>
                                    )}
                                    <input type="file" id="box-item-upload" style={{ display: 'none' }} accept="image/*" onChange={onFileChange} />
                                    <label htmlFor="box-item-upload" className="btn btn-secondary" style={{ cursor: 'pointer' }}><Upload size={14} /> Upload</label>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                            <button className="btn btn-secondary" onClick={() => setIsEditingItem(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSaveItem}>Save</button>
                        </div>
                    </div>
                </div>
            )}

            {/* CROPPER MODAL (Triggered by File Input in Item Modal) */}
            {showCropper && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
                }}>
                    <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto' }}>
                        <h3 style={{ color: '#000', marginBottom: '1rem', textAlign: 'center' }}>Crop Image</h3>
                        {imageSrc && (
                            <ReactCrop
                                crop={crop}
                                onChange={(_, percentCrop) => setCrop(percentCrop)}
                                onComplete={(c) => setCompletedCrop(c)}
                            >
                                <img src={imageSrc} onLoad={onImageLoad} style={{ maxWidth: '100%', maxHeight: '60vh' }} />
                            </ReactCrop>
                        )}
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', justifyContent: 'center' }}>
                            <button
                                onClick={handleUploadImage}
                                disabled={isUploading}
                                className="btn btn-primary"
                            >
                                {isUploading ? <><Loader2 className="spin" size={16} /> Uploading...</> : 'Confirm & Upload'}
                            </button>
                            <button
                                onClick={() => { setShowCropper(false); setImageSrc(null); }}
                                className="btn btn-secondary"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
