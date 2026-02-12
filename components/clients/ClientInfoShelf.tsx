'use client';

import React from 'react';
import {
    X, ExternalLink, MapPin, Phone, Mail, User, Info,
    Calendar, DollarSign, StickyNote, Square, CheckSquare,
    Users, FileText, CheckCircle, XCircle, Clock, Download,
    MessageSquare, Pencil, Trash2, Check, Save, Trash, Loader2, Plus
} from 'lucide-react';
import { ClientProfile, ClientStatus, Navigator, Submission, GlobalLocation } from '@/lib/types';
import { useState, useEffect } from 'react';
import { addDependent, getDependentsByParentId, updateClient, deleteClient } from '@/lib/actions';
import { getSingleForm, deleteSubmission, getClientSubmissions } from '@/lib/form-actions';
import FormFiller from '@/components/forms/FormFiller';
import { FormSchema } from '@/lib/form-types';
import styles from './ClientInfoShelf.module.css';
import { UnitsModal } from './UnitsModal';
import { logNavigatorAction } from '@/lib/actions';

interface ClientInfoShelfProps {
    client: ClientProfile;
    statuses: ClientStatus[];
    navigators: Navigator[];
    globalLocations?: GlobalLocation[];
    orderSummary: React.ReactNode;
    submissions?: Submission[];
    allClients?: ClientProfile[];
    onClose: () => void;
    onOpenProfile: (clientId: string) => void;
    onClientUpdated?: () => void;
    onClientDeleted?: () => void;
    currentUser?: { role: string; id: string } | null;
    onBackgroundSave?: (clientId: string, clientName: string, saveAction: () => Promise<void>) => void;
}

export function ClientInfoShelf({
    client,
    statuses,
    navigators,
    globalLocations = [],
    orderSummary,
    submissions = [],
    allClients = [],
    onClose,
    onOpenProfile,
    onClientUpdated,
    onClientDeleted,
    currentUser,
    onBackgroundSave
}: ClientInfoShelfProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Units Prompt State
    const [showUnitsModal, setShowUnitsModal] = useState(false);
    const [pendingStatusChange, setPendingStatusChange] = useState<{ oldStatusId: string, newStatusId: string } | null>(null);
    const [pendingEditForm, setPendingEditForm] = useState<any>(null);
    const [editForm, setEditForm] = useState({
        fullName: client.fullName,
        statusId: client.statusId,
        navigatorId: client.navigatorId,
        locationId: client.locationId || '',
        phoneNumber: client.phoneNumber,
        secondaryPhoneNumber: client.secondaryPhoneNumber || '',
        email: client.email || '',
        address: client.address,
        notes: client.notes,
        authorizedAmount: client.authorizedAmount || 0,
        expirationDate: client.expirationDate || '',
        approvedMealsPerWeek: client.approvedMealsPerWeek || 0,
        caseId: client.upcomingOrder?.caseId || ''
    });

    // Dependent State
    const [showAddDependentForm, setShowAddDependentForm] = useState(false);
    const [dependentName, setDependentName] = useState('');
    const [dependentDob, setDependentDob] = useState('');
    const [dependentCin, setDependentCin] = useState('');
    const [creatingDependent, setCreatingDependent] = useState(false);
    const [localDependents, setLocalDependents] = useState<ClientProfile[]>([]);
    const [dependentSubmissions, setDependentSubmissions] = useState<Record<string, Submission[]>>({});

    // Screening State
    const [loadingForm, setLoadingForm] = useState(false);
    const [isFillingForm, setIsFillingForm] = useState(false);
    const [formSchema, setFormSchema] = useState<FormSchema | null>(null);
    const [screeningTargetId, setScreeningTargetId] = useState<string | null>(null);

    useEffect(() => {
        if (allClients.length > 0) {
            setLocalDependents(allClients.filter(c => c.parentClientId === client.id));
        } else {
            // Fetch if not provided (fallback)
            const fetchDependents = async () => {
                try {
                    const deps = await getDependentsByParentId(client.id);
                    setLocalDependents(deps);
                } catch (error) {
                    console.error('Error fetching dependents:', error);
                }
            };
            fetchDependents();
        }
    }, [allClients, client.id]);

    // Load dependent submissions whenever dependents change
    useEffect(() => {
        const fetchDependentSubmissions = async () => {
            if (localDependents.length === 0) return;

            const subs: Record<string, Submission[]> = {};
            await Promise.all(localDependents.map(async (dep) => {
                try {
                    const res = await getClientSubmissions(dep.id);
                    if (res.success && res.data) {
                        subs[dep.id] = res.data;
                    }
                } catch (e) {
                    console.error(`Error loading submissions for dependent ${dep.id}`, e);
                }
            }));
            setDependentSubmissions(subs);
        };

        fetchDependentSubmissions();
    }, [localDependents]);

    const status = statuses.find(s => s.id === (isEditing ? editForm.statusId : client.statusId));
    const navigator = navigators.find(n => n.id === (isEditing ? editForm.navigatorId : client.navigatorId));
    const location = globalLocations?.find(l => l.id === (isEditing ? editForm.locationId : client.locationId));

    const handleSave = async (): Promise<boolean> => {
        // Intercept for Navigator Status Change
        if (currentUser?.role === 'navigator' && editForm.statusId !== client.statusId) {
            const newStatus = statuses.find(s => s.id === editForm.statusId);
            if (newStatus?.requiresUnitsOnChange) {
                setPendingStatusChange({
                    oldStatusId: client.statusId,
                    newStatusId: editForm.statusId
                });
                setPendingEditForm(editForm);
                setShowUnitsModal(true);
                return false; // Stop here, wait for modal, DO NOT CLOSE SHELF
            }
        }

        const performSave = async () => {
            await executeSave(0);
        };

        if (onBackgroundSave) {
            // Background save mode: trigger and return true to indicate shelf can close
            onBackgroundSave(client.id, client.fullName, performSave);
            return true;
        } else {
            // Fallback to blocking save
            await executeSave(0);
            return true;
        }
    };

    const handleOverlayClick = async () => {
        if (isEditing) {
            const success = await handleSave();
            if (success) {
                onClose();
            }
        } else {
            onClose();
        }
    };

    const executeSave = async (unitsAdded: number) => {
        setIsSaving(true);
        try {
            // Use pending form if available (from modal flow), otherwise current editForm
            const formToSave = pendingEditForm || editForm;

            // Include caseId in upcomingOrder if it was modified
            const updatedUpcomingOrder = {
                ...(client.upcomingOrder || { serviceType: client.serviceType }),
                caseId: formToSave.caseId,
                serviceType: client.upcomingOrder?.serviceType || client.serviceType
            };

            await updateClient(client.id, {
                ...formToSave,
                upcomingOrder: updatedUpcomingOrder
            });

            // Log units if applicable
            if (currentUser?.role === 'navigator' && unitsAdded > 0 && pendingStatusChange) {
                await logNavigatorAction({
                    navigatorId: currentUser.id,
                    clientId: client.id,
                    oldStatus: pendingStatusChange.oldStatusId,
                    newStatus: pendingStatusChange.newStatusId,
                    unitsAdded
                });
            }

            setIsEditing(false);
            // Reset pending state
            setShowUnitsModal(false);
            setPendingStatusChange(null);
            setPendingEditForm(null);

            if (onClientUpdated) onClientUpdated();
        } catch (error) {
            console.error('Failed to update client:', error);
            alert('Failed to save changes. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (confirm(`Are you sure you want to delete ${client.fullName}? This action cannot be undone.`)) {
            try {
                await deleteClient(client.id);
                onClose();
                if (onClientDeleted) onClientDeleted();
            } catch (error) {
                console.error('Failed to delete client:', error);
                alert('Failed to delete client. Please try again.');
            }
        }
    };

    const handleCreateDependent = async () => {
        if (!dependentName.trim() || !client.id) return;

        setCreatingDependent(true);
        try {
            const newDep = await addDependent(
                dependentName.trim(),
                client.id,
                dependentDob || null,
                dependentCin || null
            );
            if (newDep) {
                // Update local state
                setLocalDependents(prev => [...prev, newDep]);
                // Reset form
                setDependentName('');
                setDependentDob('');
                setDependentCin('');
                setShowAddDependentForm(false);
                // Notify parent
                if (onClientUpdated) onClientUpdated();
            }
        } catch (error) {
            console.error('Error creating dependent:', error);
            alert(error instanceof Error ? error.message : 'Failed to create dependent');
        } finally {
            setCreatingDependent(false);
        }
    };

    const handleOpenScreeningForm = async (targetId?: string) => {
        const target = typeof targetId === 'string' ? targetId : client.id;
        setScreeningTargetId(target);
        setLoadingForm(true);
        try {
            const response = await getSingleForm();
            if (response.success && response.data) {
                setFormSchema(response.data);
                setIsFillingForm(true);
            } else {
                alert('No Screening Form configured.');
            }
        } catch (error) {
            console.error('Failed to load form:', error);
            alert('Failed to load form. Please try again.');
        } finally {
            setLoadingForm(false);
        }
    };

    const handleCloseScreeningForm = async () => {
        setIsFillingForm(false);
        setFormSchema(null);
        setScreeningTargetId(null);
        if (onClientUpdated) {
            onClientUpdated();
            // Also refresh dependents locally if needed (though onClientUpdated likely re-fetches parent which triggers dependents reload)
            // But we should refresh dependent submissions explicitly if it was a dependent form
            if (screeningTargetId && screeningTargetId !== client.id) {
                const res = await getClientSubmissions(screeningTargetId);
                if (res.success && res.data) {
                    setDependentSubmissions(prev => ({ ...prev, [screeningTargetId]: res.data }));
                }
                // And refresh dependent list to get updated status
                const deps = await getDependentsByParentId(client.id);
                setLocalDependents(deps);
            }
        }
    };

    const handleDeleteSubmission = async (submissionId: string) => {
        if (!confirm('Are you sure you want to delete this submission? This action cannot be undone and will delete the associated files.')) return;

        try {
            const res = await deleteSubmission(submissionId);
            if (res.success) {
                if (onClientUpdated) onClientUpdated();
            } else {
                alert('Failed to delete submission: ' + res.error);
            }
        } catch (error) {
            console.error('Error deleting submission:', error);
            alert('An error occurred while deleting the submission.');
        }
    };

    const handleDeleteDependentSubmission = async (dependentId: string, submissionId: string) => {
        if (!confirm('Are you sure you want to delete this submission? This action cannot be undone.')) return;

        try {
            const res = await deleteSubmission(submissionId);
            if (res.success) {
                // Refresh dependent submissions
                const subRes = await getClientSubmissions(dependentId);
                if (subRes.success && subRes.data) {
                    setDependentSubmissions(prev => ({ ...prev, [dependentId]: subRes.data }));
                }
                // Update dependent status in list
                const deps = await getDependentsByParentId(client.id);
                setLocalDependents(deps);
            } else {
                alert('Failed to delete submission: ' + res.error);
            }
        } catch (error) {
            console.error('Error deleting dependent submission:', error);
            alert('An error occurred.');
        }
    };

    return (
        <>
            <UnitsModal
                isOpen={showUnitsModal}
                onClose={() => {
                    setShowUnitsModal(false);
                    setPendingStatusChange(null);
                    setPendingEditForm(null);
                }}
                onConfirm={executeSave}
                saving={isSaving}
            />
            <div className={styles.shelfOverlay} onClick={handleOverlayClick} />
            <div className={styles.shelf}>
                <div className={styles.header}>
                    <div className={styles.titleSection}>
                        {isEditing ? (
                            <input
                                className={styles.editInput}
                                value={editForm.fullName}
                                onChange={e => setEditForm({ ...editForm, fullName: e.target.value })}
                                autoFocus
                            />
                        ) : (
                            <>
                                <h2>{client.fullName}</h2>
                                <a 
                                    href={`/client-portal/${client.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ 
                                        fontSize: '0.85rem', 
                                        color: 'var(--text-tertiary)', 
                                        marginTop: '4px',
                                        textDecoration: 'none',
                                        cursor: 'pointer'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.color = 'var(--color-primary)';
                                        e.currentTarget.style.textDecoration = 'underline';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.color = 'var(--text-tertiary)';
                                        e.currentTarget.style.textDecoration = 'none';
                                    }}
                                >
                                    ID: {client.id}
                                </a>
                            </>
                        )}
                    </div>
                    <div className={styles.headerActions}>
                        {isEditing ? (
                            <>
                                <button className={styles.saveBtn} onClick={handleSave} disabled={isSaving}>
                                    {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                                </button>
                                <button className={styles.cancelBtn} onClick={() => {
                                    setIsEditing(false);
                                    setEditForm({
                                        fullName: client.fullName,
                                        statusId: client.statusId,
                                        navigatorId: client.navigatorId,
                                        locationId: client.locationId || '',
                                        phoneNumber: client.phoneNumber,
                                        secondaryPhoneNumber: client.secondaryPhoneNumber || '',
                                        email: client.email || '',
                                        address: client.address,
                                        notes: client.notes,
                                        authorizedAmount: client.authorizedAmount || 0,
                                        expirationDate: client.expirationDate || '',
                                        approvedMealsPerWeek: client.approvedMealsPerWeek || 0,
                                        caseId: client.upcomingOrder?.caseId || ''
                                    });
                                }}>
                                    <X size={18} />
                                </button>
                            </>
                        ) : (
                            <>
                                <button className={styles.editBtn} onClick={() => setIsEditing(true)}>
                                    <Pencil size={18} />
                                </button>
                                <button className={styles.deleteBtn} onClick={handleDelete}>
                                    <Trash2 size={18} />
                                </button>
                                <button className={styles.closeBtn} onClick={onClose}>
                                    <X size={24} />
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {isFillingForm && formSchema && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'white',
                        zIndex: 10000,
                        padding: '2rem',
                        overflowY: 'auto'
                    }}>
                        <FormFiller
                            schema={formSchema}
                            onBack={handleCloseScreeningForm}
                            clientId={screeningTargetId || client.id}
                        />
                    </div>
                )}

                <div className={styles.content}>
                    <div className={styles.section}>
                        <h3>Service Information</h3>
                        <div className={styles.infoGrid}>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Navigator</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <select
                                            className={styles.editSelect}
                                            value={editForm.navigatorId}
                                            onChange={e => setEditForm({ ...editForm, navigatorId: e.target.value })}
                                        >
                                            <option value="">Select Navigator</option>
                                            {navigators.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                                        </select>
                                    ) : (
                                        navigator?.name || 'Unassigned'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <div style={{ flex: 1 }}>
                                        <div className={styles.label}>Status</div>
                                        <div className={styles.value}>
                                            {isEditing ? (
                                                <select
                                                    className={styles.editSelect}
                                                    value={editForm.statusId}
                                                    onChange={e => setEditForm({ ...editForm, statusId: e.target.value })}
                                                >
                                                    <option value="">Select Status</option>
                                                    {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                                </select>
                                            ) : (
                                                status?.name || 'Unknown'
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div className={styles.label}>Location</div>
                                        <div className={styles.value}>
                                            {isEditing ? (
                                                <select
                                                    className={styles.editSelect}
                                                    value={editForm.locationId}
                                                    onChange={e => setEditForm({ ...editForm, locationId: e.target.value })}
                                                >
                                                    <option value="">No Location</option>
                                                    {globalLocations && globalLocations.length > 0 ? (
                                                        globalLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)
                                                    ) : (
                                                        <option disabled>No locations found</option>
                                                    )}
                                                </select>
                                            ) : (
                                                location?.name || 'Unassigned'
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Service Type</div>
                                <div className={styles.value}>
                                    {client.serviceType || '-'}
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Case ID</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.caseId}
                                            onChange={e => setEditForm({ ...editForm, caseId: e.target.value })}
                                            placeholder="Case ID"
                                        />
                                    ) : (
                                        client.upcomingOrder?.caseId || '-'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>Active Order Summary</div>
                                <div
                                    className={styles.orderSummaryBox}
                                    onClick={() => onOpenProfile(client.id)}
                                    style={{ cursor: 'pointer', transition: 'background-color 0.2s' }}
                                    title="Click to view full order details"
                                >
                                    {orderSummary || 'No active order'}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={styles.section}>
                        <h3>Financials & Eligibility</h3>
                        <div className={styles.infoGrid}>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Authorized Amount ($)</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ color: 'var(--text-secondary)' }}>$</span>
                                            <input
                                                type="number"
                                                className={styles.editInput}
                                                value={editForm.authorizedAmount}
                                                onChange={e => setEditForm({ ...editForm, authorizedAmount: parseFloat(e.target.value) || 0 })}
                                            />
                                        </div>
                                    ) : (
                                        client.authorizedAmount !== null && client.authorizedAmount !== undefined
                                            ? `$${Number(client.authorizedAmount).toFixed(2)}`
                                            : '-'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Expiration Date</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            type="date"
                                            className={styles.editInput}
                                            value={editForm.expirationDate ? editForm.expirationDate.split('T')[0] : ''}
                                            onChange={e => setEditForm({ ...editForm, expirationDate: e.target.value })}
                                        />
                                    ) : (
                                        client.expirationDate
                                            ? new Date(client.expirationDate).toLocaleDateString(undefined, { timeZone: 'UTC' })
                                            : '-'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>
                                    {client.serviceType === 'Boxes' ? 'Approved Boxes/Cycle' : 'Approved Meals/Week'}
                                </div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <input
                                                type="number"
                                                className={styles.editInput}
                                                value={editForm.approvedMealsPerWeek}
                                                onChange={e => {
                                                    const val = parseInt(e.target.value) || 0;
                                                    setEditForm({ ...editForm, approvedMealsPerWeek: val });
                                                }}
                                            />
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                                {client.serviceType === 'Boxes' ? 'Boxes/Cycle' : 'Meals/Week'}
                                            </span>
                                        </div>
                                    ) : (
                                        client.serviceType === 'Boxes'
                                            ? `${client.approvedMealsPerWeek || 0} Boxes/Cycle`
                                            : `${client.approvedMealsPerWeek || 0} Meals/Week`
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={styles.section}>
                        <h3>Contact Details</h3>
                        <div className={styles.infoGrid}>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Phone Number</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.phoneNumber}
                                            onChange={e => setEditForm({ ...editForm, phoneNumber: e.target.value })}
                                            placeholder="Primary Phone"
                                        />
                                    ) : (
                                        client.phoneNumber || '-'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Secondary Phone</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.secondaryPhoneNumber}
                                            onChange={e => setEditForm({ ...editForm, secondaryPhoneNumber: e.target.value })}
                                            placeholder="Secondary Phone"
                                        />
                                    ) : (
                                        client.secondaryPhoneNumber || '-'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>Email Address</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.email}
                                            onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                                        />
                                    ) : (
                                        client.email || '-'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>Address</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.address}
                                            onChange={e => setEditForm({ ...editForm, address: e.target.value })}
                                        />
                                    ) : (
                                        client.address || '-'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>General Notes</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <textarea
                                            className={styles.editTextarea}
                                            value={editForm.notes}
                                            onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                                            rows={3}
                                        />
                                    ) : (
                                        <div style={{ fontSize: '0.9rem', fontStyle: 'italic', color: 'var(--text-secondary)' }}>
                                            {client.notes ? (
                                                <>
                                                    <StickyNote size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                                                    {client.notes}
                                                </>
                                            ) : '-'}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>


                    {/* Dependents Section */}
                    {!client.parentClientId && (
                        <div className={styles.section}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <h3>Dependents</h3>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setShowAddDependentForm(!showAddDependentForm)}
                                    style={{ fontSize: '0.75rem' }}
                                >
                                    <Plus size={14} style={{ marginRight: '4px' }} />
                                    {showAddDependentForm ? 'Cancel' : 'Add Dependent'}
                                </button>
                            </div>

                            {showAddDependentForm && (
                                <div style={{
                                    padding: '12px',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    backgroundColor: 'var(--bg-surface-hover)',
                                    marginBottom: '12px'
                                }}>
                                    <div className={styles.formGroup} style={{ marginBottom: '8px' }}>
                                        <label className="label" style={{ fontSize: '0.75rem' }}>Name</label>
                                        <input
                                            className="input input-sm"
                                            value={dependentName}
                                            onChange={e => setDependentName(e.target.value)}
                                            placeholder="Dependent Name"
                                            autoFocus
                                        />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                                        <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                                            <label className="label" style={{ fontSize: '0.75rem' }}>DOB</label>
                                            <input
                                                type="date"
                                                className="input input-sm"
                                                value={dependentDob}
                                                onChange={e => setDependentDob(e.target.value)}
                                            />
                                        </div>
                                        <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                                            <label className="label" style={{ fontSize: '0.75rem' }}>CIN#</label>
                                            <input
                                                className="input input-sm"
                                                value={dependentCin}
                                                onChange={e => setDependentCin(e.target.value)}
                                                placeholder="CIN"
                                            />
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setShowAddDependentForm(false)}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="btn btn-primary btn-sm"
                                            disabled={!dependentName.trim() || creatingDependent}
                                            onClick={handleCreateDependent}
                                        >
                                            {creatingDependent ? <Loader2 className="animate-spin" size={14} /> : 'Create'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {localDependents.length === 0 ? (
                                <div className={styles.emptyText}>No dependents</div>
                            ) : (
                                <div className={styles.dependentsList}>
                                    {localDependents.map(dep => (
                                        <div
                                            key={dep.id}
                                            className={styles.dependentCard}
                                        // onClick={() => onOpenProfile(dep.id)} // Removed global click to avoid conflict with buttons
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <div onClick={() => onOpenProfile(dep.id)} style={{ cursor: 'pointer', flex: 1 }}>
                                                    <div className={styles.depName}>{dep.fullName}</div>
                                                    <div className={styles.depInfo}>
                                                        {dep.dob && <span>DOB: {new Date(dep.dob).toLocaleDateString(undefined, { timeZone: 'UTC' })}</span>}
                                                        {dep.cin && <span> | CIN: {dep.cin}</span>}
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                                                    <div style={{
                                                        fontSize: '0.7rem',
                                                        fontWeight: 500,
                                                        color: (() => {
                                                            const status = dep.screeningStatus || 'not_started';
                                                            switch (status) {
                                                                case 'waiting_approval': return '#eab308'; // yellow-500
                                                                case 'approved': return 'var(--color-success)';
                                                                case 'rejected': return 'var(--color-danger)';
                                                                default: return 'var(--text-tertiary)';
                                                            }
                                                        })()
                                                    }}>
                                                        {(() => {
                                                            const status = dep.screeningStatus || 'not_started';
                                                            switch (status) {
                                                                case 'not_started': return 'Not Started';
                                                                case 'waiting_approval': return 'Pending';
                                                                case 'approved': return 'Approved';
                                                                case 'rejected': return 'Rejected';
                                                                default: return 'Not Started';
                                                            }
                                                        })()}
                                                    </div>
                                                    <button
                                                        className="btn btn-secondary btn-sm"
                                                        style={{
                                                            fontSize: '0.7rem',
                                                            padding: '2px 8px',
                                                            height: '24px',
                                                            minHeight: 'unset'
                                                        }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleOpenScreeningForm(dep.id);
                                                        }}
                                                    >
                                                        {dep.screeningStatus === 'not_started' ? 'Start Screening' : 'New Form'}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Inline Submissions List */}
                                            {dependentSubmissions[dep.id] && dependentSubmissions[dep.id].length > 0 && (
                                                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                                                    <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                                        SUBMISSIONS
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                        {dependentSubmissions[dep.id].map(sub => (
                                                            <div key={sub.id} style={{
                                                                display: 'flex',
                                                                justifyContent: 'space-between',
                                                                alignItems: 'center',
                                                                backgroundColor: 'var(--bg-surface)',
                                                                padding: '8px',
                                                                borderRadius: '4px',
                                                                fontSize: '0.75rem'
                                                            }}>
                                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                    {sub.status === 'accepted' && <CheckCircle size={14} color="#10b981" />}
                                                                    {sub.status === 'rejected' && <XCircle size={14} color="#ef4444" />}
                                                                    {sub.status === 'pending' && <Clock size={14} color="#f59e0b" />}
                                                                    <span>{new Date(sub.created_at).toLocaleDateString()}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                                    <a
                                                                        href={`/verify-order/${sub.token}`}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        style={{
                                                                            textDecoration: 'none',
                                                                            color: 'var(--color-primary)',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '4px'
                                                                        }}
                                                                        onClick={e => e.stopPropagation()}
                                                                    >
                                                                        <ExternalLink size={12} /> View
                                                                    </a>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleDeleteDependentSubmission(dep.id, sub.id);
                                                                        }}
                                                                        style={{
                                                                            border: 'none',
                                                                            background: 'none',
                                                                            color: 'var(--text-tertiary)',
                                                                            cursor: 'pointer',
                                                                            padding: 0
                                                                        }}
                                                                        title="Delete"
                                                                    >
                                                                        <Trash2 size={12} />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Screening Submissions Section */}
                    <div className={styles.section}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <div>
                                <h3 style={{ marginBottom: '2px' }}>Screening Form Submissions</h3>
                                <div style={{
                                    fontSize: '0.75rem',
                                    fontWeight: 500,
                                    color: (() => {
                                        const status = client?.screeningStatus || 'not_started';
                                        switch (status) {
                                            case 'waiting_approval': return '#eab308';
                                            case 'approved': return 'var(--color-success)';
                                            case 'rejected': return 'var(--color-danger)';
                                            default: return 'var(--text-tertiary)';
                                        }
                                    })()
                                }}>
                                    Status: {(() => {
                                        const status = client?.screeningStatus || 'not_started';
                                        switch (status) {
                                            case 'not_started': return 'Not Started';
                                            case 'waiting_approval': return 'Pending Approval';
                                            case 'approved': return 'Approved';
                                            case 'rejected': return 'Rejected';
                                            default: return 'Not Started';
                                        }
                                    })()}
                                </div>
                            </div>
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={() => handleOpenScreeningForm(client.id)}
                                disabled={loadingForm}
                                style={{ fontSize: '0.75rem' }}
                            >
                                {loadingForm ? (
                                    <Loader2 className="animate-spin" size={14} />
                                ) : (
                                    <>
                                        <FileText size={14} style={{ marginRight: '4px' }} />
                                        New Form
                                    </>
                                )}
                            </button>
                        </div>
                        <div className={styles.submissionsList}>
                            {submissions.length === 0 ? (
                                <div className={styles.emptyText}>No submissions yet</div>
                            ) : (
                                submissions.map((sub) => (
                                    <div key={sub.id} className={styles.submissionCard} style={{ borderLeftColor: getStatusColor(sub.status) }}>
                                        <div className={styles.subHeader}>
                                            <div className={styles.subMeta}>
                                                {sub.status === 'accepted' && <CheckCircle size={16} color="#10b981" />}
                                                {sub.status === 'rejected' && <XCircle size={16} color="#ef4444" />}
                                                {sub.status === 'pending' && <Clock size={16} color="#f59e0b" />}
                                                <span className={styles.subDate}>{new Date(sub.created_at).toLocaleDateString()}</span>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                {sub.status === 'pending' && (
                                                    <a
                                                        href={`/verify-order/${sub.token}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className={styles.downloadBtn}
                                                        style={{ textDecoration: 'none' }}
                                                    >
                                                        <ExternalLink size={14} /> Open
                                                    </a>
                                                )}
                                                {sub.status === 'accepted' && sub.pdf_url && (
                                                    <button
                                                        className={styles.downloadBtn}
                                                        onClick={() => {
                                                            const r2Domain = process.env.NEXT_PUBLIC_R2_DOMAIN;
                                                            if (!r2Domain) return;
                                                            // Remove trailing slash if present
                                                            const cleanDomain = r2Domain.endsWith('/') ? r2Domain.slice(0, -1) : r2Domain;
                                                            const url = cleanDomain.startsWith('http')
                                                                ? `${cleanDomain}/${sub.pdf_url}`
                                                                : `https://${cleanDomain}/${sub.pdf_url}`;
                                                            window.open(url, '_blank');
                                                        }}
                                                    >
                                                        <Download size={14} /> PDF
                                                    </button>
                                                )}
                                                <button
                                                    className={styles.deleteBtn}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteSubmission(sub.id);
                                                    }}
                                                    title="Delete Submission"
                                                    style={{ padding: '4px', height: 'auto', minHeight: 'unset', width: 'auto' }}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                        {sub.comments && (
                                            <div style={{
                                                marginTop: '8px',
                                                fontSize: '0.8125rem',
                                                color: 'var(--text-secondary)',
                                                borderTop: '1px solid var(--border-color)',
                                                paddingTop: '8px'
                                            }}>
                                                <strong>Comment:</strong> {sub.comments}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                <div className={styles.footer}>
                    <button
                        className={styles.actionBtn}
                        onClick={() => onOpenProfile(client.id)}
                    >
                        Open Order Details
                        <ExternalLink size={18} />
                    </button>
                </div>
            </div>
        </>
    );
}

function getStatusColor(status: string) {
    switch (status) {
        case 'accepted': return '#10b981';
        case 'rejected': return '#ef4444';
        case 'pending': return '#f59e0b';
        default: return '#6b7280';
    }
}
