'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, ServiceType, AppSettings, DeliveryRecord, ItemCategory, BoxQuota } from '@/lib/types';
import { getClient, updateClient, deleteClient, getStatuses, getNavigators, getVendors, getMenuItems, getBoxTypes, getSettings, getClientHistory, updateDeliveryProof, recordClientChange, getOrderHistory, getCategories, getBoxQuotas } from '@/lib/actions';
import { Save, ArrowLeft, Truck, Package, AlertTriangle, Upload, Trash2, Plus, Check, ClipboardList, History, CreditCard } from 'lucide-react';
import styles from './ClientProfile.module.css';
import { OrderHistoryItem } from './OrderHistoryItem';

interface Props {
    clientId: string;
    onClose?: () => void;
}

const SERVICE_TYPES: ServiceType[] = ['Food', 'Boxes', 'Cooking supplies', 'Care plan'];

export function ClientProfileDetail({ clientId: propClientId, onClose }: Props) {
    const router = useRouter();
    const params = useParams();
    const clientId = (params?.id as string) || propClientId;

    const [client, setClient] = useState<ClientProfile | null>(null);
    const [statuses, setStatuses] = useState<ClientStatus[]>([]);
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [categories, setCategories] = useState<ItemCategory[]>([]);
    const [activeBoxQuotas, setActiveBoxQuotas] = useState<BoxQuota[]>([]);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [history, setHistory] = useState<DeliveryRecord[]>([]);
    const [orderHistory, setOrderHistory] = useState<any[]>([]);
    const [activeHistoryTab, setActiveHistoryTab] = useState<'deliveries' | 'audit'>('deliveries');

    const [formData, setFormData] = useState<Partial<ClientProfile>>({});
    const [orderConfig, setOrderConfig] = useState<any>({});

    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<{ show: boolean, messages: string[] }>({ show: false, messages: [] });

    useEffect(() => {
        loadData();
    }, [clientId]);

    async function loadData() {
        const [c, s, n, v, m, b, appSettings, catData] = await Promise.all([
            getClient(clientId),
            getStatuses(),
            getNavigators(),
            getVendors(),
            getMenuItems(),
            getBoxTypes(),
            getSettings(),
            getCategories()
        ]);

        if (c) {
            setClient(c);
            setFormData(c);
            const activeOrder: any = c.activeOrder || { serviceType: c.serviceType };
            // Migration/Safety: Ensure vendorSelections exists for Food
            if (activeOrder.serviceType === 'Food' && !activeOrder.vendorSelections) {
                if (activeOrder.vendorId) {
                    // Migrate old format
                    activeOrder.vendorSelections = [{ vendorId: activeOrder.vendorId, items: activeOrder.menuSelections || {} }];
                } else {
                    activeOrder.vendorSelections = [{ vendorId: '', items: {} }];
                }
            }
            setOrderConfig(activeOrder);

            const [h, oh] = await Promise.all([
                getClientHistory(clientId),
                getOrderHistory(clientId)
            ]);
            setHistory(h);
            setOrderHistory(oh);
        }
        setStatuses(s);
        setNavigators(n);
        setVendors(v);
        setMenuItems(m);
        setBoxTypes(b);
        setSettings(appSettings);
        setCategories(catData);
    }

    // Effect: Auto-select Box Type when Vendor changes (for Boxes)
    useEffect(() => {
        if (formData.serviceType === 'Boxes' && orderConfig.vendorId && boxTypes.length > 0) {
            // Find the box type for this vendor
            const vendorBox = boxTypes.find(b => b.vendorId === orderConfig.vendorId);
            if (vendorBox && orderConfig.boxTypeId !== vendorBox.id) {
                setOrderConfig((prev: any) => ({ ...prev, boxTypeId: vendorBox.id }));
            }
        }
    }, [orderConfig.vendorId, formData.serviceType, boxTypes]);

    // Effect: Load quotas when boxTypeId changes
    useEffect(() => {
        if (orderConfig.boxTypeId) {
            getBoxQuotas(orderConfig.boxTypeId).then(quotas => {
                setActiveBoxQuotas(quotas);
            });
        } else {
            setActiveBoxQuotas([]);
        }
    }, [orderConfig.boxTypeId]);


    // -- Logic Helpers --

    function getVendorMenuItems(vendorId: string) {
        return menuItems.filter(i => i.vendorId === vendorId && i.isActive);
    }

    function getCurrentOrderTotalValue() {
        if (!orderConfig.vendorSelections) return 0;
        let total = 0;
        for (const selection of orderConfig.vendorSelections) {
            if (!selection.items) continue;
            for (const [itemId, qty] of Object.entries(selection.items)) {
                const item = menuItems.find(i => i.id === itemId);
                total += (item ? item.value * (qty as number) : 0);
            }
        }
        return total;
    }

    function isCutoffPassed() {
        return false; // MVP simplified
    }


    if (!client) return <div>Loading...</div>;

    // Box Logic Helpers
    function getBoxValidationSummary() {
        if (!activeBoxQuotas.length) return { isValid: true, messages: [] };

        const summary: string[] = [];
        let allValid = true;
        const selectedItems = orderConfig.items || {};

        activeBoxQuotas.forEach(quota => {
            const category = categories.find(c => c.id === quota.categoryId);
            if (!category) return;

            // Calculate current total for this category
            let currentTotal = 0;
            Object.entries(selectedItems).forEach(([itemId, qty]) => {
                const item = menuItems.find(i => i.id === itemId);
                if (item && item.categoryId === quota.categoryId) {
                    currentTotal += (item.quotaValue || 1) * (qty as number);
                }
            });

            if (currentTotal !== quota.targetValue) {
                allValid = false;
                summary.push(`${category.name}: Selected ${currentTotal} / Target ${quota.targetValue}`);
            }
        });

        return { isValid: allValid, messages: summary };
    }

    function validateOrder(): { isValid: boolean, messages: string[] } {
        if (formData.serviceType === 'Food') {
            const currentTotal = getCurrentOrderTotalValue();
            const limit = formData.approvedMealsPerWeek || 0;
            if (currentTotal > limit) {
                return {
                    isValid: false,
                    messages: [`Order value (${currentTotal}) exceeds approved limit (${limit}).`]
                };
            }
        }

        if (formData.serviceType === 'Boxes' && orderConfig.boxTypeId) {
            return getBoxValidationSummary();
        }

        return { isValid: true, messages: [] };
    }

    function handleBoxItemChange(itemId: string, qty: number) {
        const currentItems = { ...(orderConfig.items || {}) };
        if (qty > 0) {
            currentItems[itemId] = qty;
        } else {
            delete currentItems[itemId];
        }
        setOrderConfig({ ...orderConfig, items: currentItems });
    }

    async function handleDelete() {
        if (!confirm('Are you sure you want to delete this client? This action cannot be undone.')) return;

        setSaving(true);
        await deleteClient(clientId);
        setSaving(false);

        if (onClose) {
            onClose();
        } else {
            router.push('/clients');
        }
    }

    async function handleSave(): Promise<boolean> {
        if (!client) return false;

        const validation = validateOrder();
        if (!validation.isValid) {
            setValidationError({ show: true, messages: validation.messages });
            return false;
        }

        setSaving(true);

        // -- Change Detection --
        const changes: string[] = [];
        if (client.fullName !== formData.fullName) changes.push(`Full Name: "${client.fullName}" -> "${formData.fullName}"`);
        if (client.address !== formData.address) changes.push(`Address: "${client.address}" -> "${formData.address}"`);
        if (client.email !== formData.email) changes.push(`Email: "${client.email}" -> "${formData.email}"`);
        if (client.phoneNumber !== formData.phoneNumber) changes.push(`Phone: "${client.phoneNumber}" -> "${formData.phoneNumber}"`);
        if (client.notes !== formData.notes) changes.push('Notes updated');
        if (client.statusId !== formData.statusId) {
            const oldStatus = statuses.find(s => s.id === client.statusId)?.name || 'Unknown';
            const newStatus = statuses.find(s => s.id === formData.statusId)?.name || 'Unknown';
            changes.push(`Status: "${oldStatus}" -> "${newStatus}"`);
        }
        if (client.navigatorId !== formData.navigatorId) {
            const oldNav = navigators.find(n => n.id === client.navigatorId)?.name || 'Unassigned';
            const newNav = navigators.find(n => n.id === formData.navigatorId)?.name || 'Unassigned';
            changes.push(`Navigator: "${oldNav}" -> "${newNav}"`);
        }
        if (client.serviceType !== formData.serviceType) changes.push(`Service Type: "${client.serviceType}" -> "${formData.serviceType}"`);
        if (client.approvedMealsPerWeek !== formData.approvedMealsPerWeek) changes.push(`Approved Meals: ${client.approvedMealsPerWeek} -> ${formData.approvedMealsPerWeek}`);
        if (client.screeningTookPlace !== formData.screeningTookPlace) changes.push(`Screening Took Place: ${client.screeningTookPlace} -> ${formData.screeningTookPlace}`);
        if (client.screeningSigned !== formData.screeningSigned) changes.push(`Screening Signed: ${client.screeningSigned} -> ${formData.screeningSigned}`);

        // Simplified Order comparison
        const oldOrderStr = JSON.stringify(client.activeOrder);
        const newOrderStr = JSON.stringify(orderConfig);
        if (oldOrderStr !== newOrderStr) {
            changes.push('Order configuration changed');
        }

        const summary = changes.length > 0 ? changes.join(', ') : 'No functional changes detected (re-saved profile)';

        // Ensure structure is correct
        const cleanedOrderConfig = { ...orderConfig };
        if (formData.serviceType === 'Food') {
            // Remove empty selections or selections with no vendor
            cleanedOrderConfig.vendorSelections = (cleanedOrderConfig.vendorSelections || [])
                .filter((s: any) => s.vendorId)
                .map((s: any) => ({
                    vendorId: s.vendorId,
                    items: s.items || {}
                }));
        }

        const updateData: Partial<ClientProfile> = {
            ...formData,
            activeOrder: {
                ...cleanedOrderConfig,
                serviceType: formData.serviceType,
                lastUpdated: new Date().toISOString(),
                updatedBy: 'Admin'
            }
        };

        await updateClient(clientId, updateData);
        await recordClientChange(clientId, summary, 'Admin');

        // Refresh original client data to reflect latest saved state
        const updatedClient = await getClient(clientId);
        if (updatedClient) setClient(updatedClient);

        // Refresh history
        const oh = await getOrderHistory(clientId);
        setOrderHistory(oh);

        setSaving(false);
        setMessage('Client profile updated.');
        setTimeout(() => setMessage(null), 3000);
        return true;
    }

    async function handleSaveAndClose() {
        const saved = await handleSave();
        if (saved && onClose) {
            onClose();
        }
    }

    async function handleBack() {
        // If used as a page (not modal), we want to try to save before leaving.
        // If validation fails, handleSave will return false and show the error modal.
        // The user effectively stays on the page.
        if (onClose) {
            await handleSaveAndClose();
        } else {
            const saved = await handleSave();
            if (saved) {
                router.push('/clients');
            }
        }
    }

    function handleDiscardChanges() {
        setValidationError({ show: false, messages: [] });
        // Discarding means we just exit without saving
        if (onClose) {
            onClose();
        } else {
            router.push('/clients');
        }
    }

    // -- Event Handlers --

    function handleServiceChange(type: ServiceType) {
        if (formData.serviceType === type) return;

        // Check if there is existing configuration to warn about
        const hasConfig = orderConfig.caseId ||
            orderConfig.vendorSelections?.some((s: any) => s.vendorId) ||
            orderConfig.vendorId;

        if (hasConfig) {
            const confirmSwitch = window.confirm(
                'Switching service types will erase the current service configuration. Are you sure you want to proceed?'
            );
            if (!confirmSwitch) return;
        }

        setFormData({ ...formData, serviceType: type });
        // Reset order config for new type completely, ensuring caseId is reset too
        // The user must enter a NEW case ID for the new service type.
        if (type === 'Food') {
            setOrderConfig({ serviceType: type, vendorSelections: [{ vendorId: '', items: {} }] });
        } else {
            setOrderConfig({ serviceType: type, items: {} });
        }
    }

    function addVendorBlock() {
        setOrderConfig({
            ...orderConfig,
            vendorSelections: [...(orderConfig.vendorSelections || []), { vendorId: '', items: {} }]
        });
    }

    function removeVendorBlock(index: number) {
        const current = [...(orderConfig.vendorSelections || [])];
        current.splice(index, 1);
        setOrderConfig({ ...orderConfig, vendorSelections: current });
    }

    function updateVendorSelection(index: number, field: string, value: any) {
        const current = [...(orderConfig.vendorSelections || [])];
        current[index] = { ...current[index], [field]: value };
        // If changing vendor, maybe clear items?
        if (field === 'vendorId') {
            current[index].items = {};
        }
        setOrderConfig({ ...orderConfig, vendorSelections: current });
    }

    function updateItemQuantity(blockIndex: number, itemId: string, qty: number) {
        const current = [...(orderConfig.vendorSelections || [])];
        const items = { ...(current[blockIndex].items || {}) };
        if (qty > 0) {
            items[itemId] = qty;
        } else {
            delete items[itemId];
        }
        current[blockIndex].items = items;
        setOrderConfig({ ...orderConfig, vendorSelections: current });
    }

    const content = (
        <div className={onClose ? '' : styles.container}>
            <header className={styles.header}>
                <button className={styles.backBtn} onClick={handleBack}>
                    <ArrowLeft size={20} /> {onClose ? 'Close' : 'Back to List'}
                </button>
                <h1 className={styles.title}>{formData.fullName}</h1>
                <div className={styles.actions}>
                    {message && <span className={styles.successMessage}>{message}</span>}
                    <button className="btn" onClick={handleDelete} style={{ marginRight: '8px', backgroundColor: '#ef4444', color: 'white', border: 'none' }}>
                        <Trash2 size={16} /> Delete
                    </button>
                    <button className="btn btn-secondary" onClick={() => router.push(`/clients/${clientId}/billing`)} style={{ marginRight: '8px' }}>
                        <CreditCard size={16} /> Billing
                    </button>
                    {!onClose && (
                        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                            <Save size={16} /> Save Changes
                        </button>
                    )}
                </div>
            </header>

            <div className={styles.grid}>
                <div className={styles.column}>
                    <section className={styles.card}>
                        <h3 className={styles.sectionTitle}>Client Details</h3>

                        <div className={styles.formGroup}>
                            <label className="label">Full Name</label>
                            <input className="input" value={formData.fullName} onChange={e => setFormData({ ...formData, fullName: e.target.value })} />
                        </div>

                        <div className={styles.formGroup}>
                            <label className="label">Status</label>
                            <select className="input" value={formData.statusId} onChange={e => setFormData({ ...formData, statusId: e.target.value })}>
                                {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>

                        <div className={styles.formGroup}>
                            <label className="label">Assigned Navigator</label>
                            <select className="input" value={formData.navigatorId} onChange={e => setFormData({ ...formData, navigatorId: e.target.value })}>
                                <option value="">Unassigned</option>
                                {navigators.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                            </select>
                        </div>

                        <div className={styles.formGroup}>
                            <label className="label">Address</label>
                            <input className="input" value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} />
                        </div>

                        <div className={styles.formGroup}>
                            <label className="label">Phone</label>
                            <input className="input" value={formData.phoneNumber} onChange={e => setFormData({ ...formData, phoneNumber: e.target.value })} />
                            <div style={{ height: '1rem' }} /> {/* Spacer */}
                            <label className="label">Email</label>
                            <input className="input" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                        </div>

                        <div className={styles.formGroup}>
                            <label className="label">General Notes</label>
                            <textarea className="input" style={{ height: '100px' }} value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} />
                        </div>

                        <div className={styles.checkboxTitle}>Screening</div>
                        <div className={styles.row}>
                            <label className={styles.checkboxLabel}>
                                <input type="checkbox" checked={formData.screeningTookPlace} onChange={e => setFormData({ ...formData, screeningTookPlace: e.target.checked })} />
                                Took Place
                            </label>
                            <label className={styles.checkboxLabel}>
                                <input type="checkbox" checked={formData.screeningSigned} onChange={e => setFormData({ ...formData, screeningSigned: e.target.checked })} />
                                Signed
                            </label>
                        </div>
                    </section>
                </div>

                <div className={styles.column}>
                    <section className={styles.card}>
                        <h3 className={styles.sectionTitle}>Service Configuration</h3>

                        <div className={styles.formGroup}>
                            <label className="label">Service Type</label>
                            <div className={styles.serviceTypes}>
                                {SERVICE_TYPES.map(type => (
                                    <button
                                        key={type}
                                        className={`${styles.serviceBtn} ${formData.serviceType === type ? styles.activeService : ''}`}
                                        onClick={() => handleServiceChange(type)}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>
                        </div>



                        <div className={styles.formGroup}>
                            <label className="label">Case ID (Required)</label>
                            <input
                                className="input"
                                value={orderConfig.caseId || ''}
                                placeholder="Enter Case ID to enable configuration..."
                                onChange={e => setOrderConfig({ ...orderConfig, caseId: e.target.value })}
                            />
                        </div>

                        {!orderConfig.caseId && (
                            <div className={styles.alert} style={{ marginTop: '16px', backgroundColor: 'var(--bg-surface-hover)' }}>
                                <AlertTriangle size={16} />
                                Please enter a Case ID to configure the service.
                            </div>
                        )}

                        {orderConfig.caseId && (
                            <>
                                {formData.serviceType === 'Food' && (
                                    <div className="animate-fade-in">
                                        <div className={styles.formGroup}>
                                            <label className="label">Approved Meals Per Week</label>
                                            <input
                                                type="number"
                                                className="input"
                                                value={formData.approvedMealsPerWeek || 0}
                                                onChange={e => setFormData({ ...formData, approvedMealsPerWeek: Number(e.target.value) })}
                                            />
                                        </div>

                                        <div className={styles.divider} />

                                        <div className={styles.orderHeader}>
                                            <h4>Current Order Request</h4>
                                            <div className={styles.budget} style={{
                                                color: getCurrentOrderTotalValue() > (formData.approvedMealsPerWeek || 0) ? 'var(--color-danger)' : 'inherit',
                                                backgroundColor: getCurrentOrderTotalValue() > (formData.approvedMealsPerWeek || 0) ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-surface-hover)'
                                            }}>
                                                Value: {getCurrentOrderTotalValue()} / {formData.approvedMealsPerWeek || 0}
                                            </div>
                                        </div>

                                        {isCutoffPassed() && <div className={styles.alert}><AlertTriangle size={16} /> Cutoff passed. Changes will apply to next cycle.</div>}

                                        {/* Multi-Vendor Configuration */}
                                        <div className={styles.vendorsList}>
                                            {(orderConfig.vendorSelections || []).map((selection: any, index: number) => (
                                                <div key={index} className={styles.vendorBlock}>
                                                    <div className={styles.vendorHeader}>
                                                        <select
                                                            className="input"
                                                            value={selection.vendorId}
                                                            onChange={e => updateVendorSelection(index, 'vendorId', e.target.value)}
                                                        >
                                                            <option value="">Select Vendor...</option>
                                                            {vendors.filter(v => v.serviceType === 'Food' && v.isActive).map(v => (
                                                                <option key={v.id} value={v.id} disabled={orderConfig.vendorSelections.some((s: any, i: number) => i !== index && s.vendorId === v.id)}>
                                                                    {v.name}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => removeVendorBlock(index)} title="Remove Vendor">
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>

                                                    {selection.vendorId && (
                                                        <div className={styles.menuList}>
                                                            {getVendorMenuItems(selection.vendorId).map(item => (
                                                                <div key={item.id} className={styles.menuItem}>
                                                                    <div className={styles.itemInfo}>
                                                                        <span>{item.name}</span>
                                                                        <span className={styles.itemValue}>Value: {item.value}</span>
                                                                    </div>
                                                                    <div className={styles.quantityControl}>
                                                                        <input
                                                                            type="number"
                                                                            className={styles.qtyInput}
                                                                            min="0"
                                                                            value={selection.items?.[item.id] || ''}
                                                                            placeholder="0"
                                                                            onChange={e => updateItemQuantity(index, item.id, parseInt(e.target.value) || 0)}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            ))}
                                                            {getVendorMenuItems(selection.vendorId).length === 0 && <span className={styles.hint}>No active menu items.</span>}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}

                                            <button className={styles.addVendorBtn} onClick={addVendorBlock}>
                                                <Plus size={14} /> Add Vendor
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {formData.serviceType === 'Boxes' && (
                                    <div className="animate-fade-in">
                                        <div className={styles.formGroup}>
                                            <label className="label">Vendor</label>
                                            <select
                                                className="input"
                                                value={orderConfig.vendorId || ''}
                                                onChange={e => {
                                                    const newVendorId = e.target.value;
                                                    setOrderConfig({
                                                        ...orderConfig,
                                                        vendorId: newVendorId,
                                                        boxTypeId: '' // Reset box selection when vendor changes
                                                    });
                                                }}
                                            >
                                                <option value="">Select Vendor...</option>
                                                {vendors.filter(v => v.serviceType === 'Boxes' && v.isActive).map(v => (
                                                    <option key={v.id} value={v.id}>{v.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div style={{ display: 'none' }}>
                                            <label className="label">Quantity</label>
                                            <input
                                                type="number"
                                                className="input"
                                                value={orderConfig.boxQuantity || 1}
                                                readOnly
                                                style={{ display: 'none' }}
                                            />
                                        </div>

                                        {/* Box Content Selection */}
                                        {orderConfig.boxTypeId && activeBoxQuotas.length > 0 && (
                                            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                                                <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <Package size={14} /> Box Contents
                                                </h4>

                                                {activeBoxQuotas.map(quota => {
                                                    const category = categories.find(c => c.id === quota.categoryId);
                                                    if (!category) return null;

                                                    // Filter items for this category and vendor
                                                    const availableItems = menuItems.filter(i =>
                                                        i.vendorId === orderConfig.vendorId &&
                                                        i.isActive &&
                                                        i.categoryId === quota.categoryId
                                                    );

                                                    // Calculate current count
                                                    let currentCount = 0;
                                                    const selectedItems = orderConfig.items || {};
                                                    Object.entries(selectedItems).forEach(([itemId, qty]) => {
                                                        const item = menuItems.find(i => i.id === itemId);
                                                        if (item && item.categoryId === quota.categoryId) {
                                                            currentCount += (item.quotaValue || 1) * (qty as number);
                                                        }
                                                    });

                                                    const isMet = currentCount === quota.targetValue;
                                                    const isOver = currentCount > quota.targetValue;

                                                    return (
                                                        <div key={quota.id} style={{ marginBottom: '1rem', background: 'var(--bg-surface-hover)', padding: '0.75rem', borderRadius: '6px' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                                                <span style={{ fontWeight: 600 }}>{category.name}</span>
                                                                <span style={{
                                                                    color: isMet ? 'var(--color-success)' : (isOver ? 'var(--color-danger)' : 'var(--color-warning)'),
                                                                    fontWeight: 600
                                                                }}>
                                                                    {currentCount} / {quota.targetValue}
                                                                </span>
                                                            </div>

                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                                {availableItems.map(item => (
                                                                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-app)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                                                                        <span style={{ fontSize: '0.8rem' }}>{item.name} <span style={{ color: 'var(--text-tertiary)' }}>({item.quotaValue || 1})</span></span>
                                                                        <input
                                                                            type="number"
                                                                            min="0"
                                                                            style={{ width: '40px', padding: '2px', fontSize: '0.8rem', textAlign: 'center' }}
                                                                            value={selectedItems[item.id] || ''}
                                                                            placeholder="0"
                                                                            onChange={e => handleBoxItemChange(item.id, Number(e.target.value))}
                                                                        />
                                                                    </div>
                                                                ))}
                                                                {availableItems.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>No items available.</span>}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </section>

                    <section className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                        <div className={styles.historyHeader}>
                            <h3 className={styles.sectionTitle}>Order History</h3>
                            <div className={styles.tabs}>
                                <button
                                    className={`${styles.tab} ${activeHistoryTab === 'deliveries' ? styles.activeTab : ''}`}
                                    onClick={() => setActiveHistoryTab('deliveries')}
                                >
                                    <ClipboardList size={14} /> Deliveries
                                </button>
                                <button
                                    className={`${styles.tab} ${activeHistoryTab === 'audit' ? styles.activeTab : ''}`}
                                    onClick={() => setActiveHistoryTab('audit')}
                                >
                                    <History size={14} /> Change Log ({orderHistory.length})
                                </button>
                            </div>
                        </div>

                        <div className={styles.historyList}>
                            {activeHistoryTab === 'deliveries' ? (
                                <>
                                    {history.map(record => (
                                        <div key={record.id} className={styles.item} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px', padding: '12px', borderBottom: '1px solid var(--border-color)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                                <span style={{ fontWeight: 500 }}>{new Date(record.deliveryDate).toLocaleDateString()}</span>
                                                <span className="badge">{record.serviceType}</span>
                                            </div>
                                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{record.itemsSummary}</div>

                                            <div style={{ width: '100%', marginTop: '8px', paddingTop: '8px' }}>
                                                {record.proofOfDeliveryImage ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <Check size={16} color="var(--color-success)" />
                                                        <a href={record.proofOfDeliveryImage} target="_blank" style={{ color: 'var(--color-primary)', fontSize: '0.875rem' }}>
                                                            Proof Uploaded
                                                        </a>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                                                        <input
                                                            placeholder="Paste Proof URL & Enter..."
                                                            className="input"
                                                            style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                                                            onKeyDown={async (e) => {
                                                                if (e.key === 'Enter') {
                                                                    await updateDeliveryProof(record.id, (e.target as HTMLInputElement).value);
                                                                    // reload
                                                                    const h = await getClientHistory(clientId);
                                                                    setHistory(h);
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {history.length === 0 && <div className={styles.empty}>No deliveries recorded yet.</div>}
                                </>
                            ) : (
                                <div className={styles.animateFadeIn}>
                                    {orderHistory.map((log, idx) => (
                                        <div key={log.id || idx} className={styles.item} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px', padding: '16px', borderBottom: '1px solid var(--border-color)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <History size={14} color="var(--color-primary)" />
                                                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{log.who}</span>
                                                </div>
                                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                                                    {new Date(log.timestamp).toLocaleString('en-US', {
                                                        month: 'short',
                                                        day: 'numeric',
                                                        year: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })}
                                                </span>
                                            </div>
                                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: '1.5' }}>
                                                {log.summary}
                                            </div>
                                        </div>
                                    ))}
                                    {orderHistory.length === 0 && <div className={styles.empty}>No changes recorded yet.</div>}
                                </div>
                            )}
                        </div>
                    </section>
                </div >
            </div >
            {
                onClose && (
                    <div className={styles.bottomAction}>
                        <button className="btn btn-primary" onClick={handleSaveAndClose} style={{ width: '200px' }}>
                            Close
                        </button>
                    </div>
                )
            }
        </div>
    );

    if (onClose) {
        return (
            <>
                <div className={styles.modalOverlay} onClick={() => {
                    // Try to save and close when clicking overlay
                    handleSaveAndClose();
                }}>
                    <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
                        {content}
                    </div>
                </div>
                {validationError.show && (
                    <div className={styles.modalOverlay} style={{ zIndex: 200 }}>
                        <div className={styles.modalContent} style={{ maxWidth: '400px', height: 'auto', padding: '24px' }} onClick={e => e.stopPropagation()}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-danger)' }}>
                                <AlertTriangle size={24} />
                                Cannot Save Order
                            </h2>
                            <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                                The current order configuration is invalid and cannot be saved.
                            </p>
                            <div style={{ background: 'var(--bg-surface-hover)', padding: '12px', borderRadius: '8px', marginBottom: '24px' }}>
                                <ul style={{ listStyle: 'disc', paddingLeft: '20px', margin: 0 }}>
                                    {validationError.messages.map((msg, i) => (
                                        <li key={i} style={{ marginBottom: '4px', color: 'var(--text-primary)' }}>{msg}</li>
                                    ))}
                                </ul>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => setValidationError({ show: false, messages: [] })}
                                >
                                    Return to Editing
                                </button>
                                <button
                                    className="btn"
                                    style={{ background: 'none', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
                                    onClick={handleDiscardChanges}
                                >
                                    Discard Changes & Exit
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </>
        );
    }

    return (
        <>
            {content}
            {validationError.show && (
                <div className={styles.modalOverlay} style={{ zIndex: 200 }}>
                    <div className={styles.modalContent} style={{ maxWidth: '400px', height: 'auto', padding: '24px' }} onClick={e => e.stopPropagation()}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-danger)' }}>
                            <AlertTriangle size={24} />
                            Cannot Save Order
                        </h2>
                        <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                            The current order configuration is invalid and cannot be saved.
                        </p>
                        <div style={{ background: 'var(--bg-surface-hover)', padding: '12px', borderRadius: '8px', marginBottom: '24px' }}>
                            <ul style={{ listStyle: 'disc', paddingLeft: '20px', margin: 0 }}>
                                {validationError.messages.map((msg, i) => (
                                    <li key={i} style={{ marginBottom: '4px', color: 'var(--text-primary)' }}>{msg}</li>
                                ))}
                            </ul>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <button
                                className="btn btn-primary"
                                onClick={() => setValidationError({ show: false, messages: [] })}
                            >
                                Return to Editing
                            </button>
                            <button
                                className="btn"
                                style={{ background: 'none', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
                                onClick={handleDiscardChanges}
                            >
                                Discard Changes & Exit
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
