'use client';

import { useState } from 'react';
import { Vendor, ServiceType } from '@/lib/types';
import { updateVendorDetails } from '@/lib/actions';
import { Check } from 'lucide-react';

interface Props {
    vendor: Vendor;
}

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SERVICE_TYPES: ServiceType[] = ['Food', 'Boxes'];

export function VendorDetailsEdit({ vendor: initialVendor }: Props) {
    const [vendor, setVendor] = useState(initialVendor);
    const [password, setPassword] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    function toggleDay(day: string) {
        const current = vendor.deliveryDays || [];
        const nextDays = current.includes(day)
            ? current.filter(d => d !== day)
            : [...current, day];

        setVendor({
            ...vendor,
            deliveryDays: nextDays,
            allowsMultipleDeliveries: nextDays.length > 1
        });
    }

    function toggleServiceType(type: ServiceType) {
        const current = vendor.serviceTypes || [];
        const nextTypes = current.includes(type)
            ? current.filter(t => t !== type)
            : [...current, type];

        // Ensure at least one type is selected
        if (nextTypes.length === 0) return;

        setVendor({ ...vendor, serviceTypes: nextTypes });
    }

    async function handleSave() {
        if (!vendor.name) {
            alert('Vendor name is required');
            return;
        }

        if (!vendor.deliveryDays || vendor.deliveryDays.length === 0) {
            alert('Please select at least one delivery day');
            return;
        }

        setIsSaving(true);
        try {
            const updateData: any = { ...vendor };
            if (password) {
                updateData.password = password;
            }
            await updateVendorDetails(updateData);
            alert('Vendor details updated successfully');
            setPassword('');
            // Reload page to get updated data
            window.location.reload();
        } catch (error) {
            console.error('Error updating vendor:', error);
            alert('Failed to update vendor details');
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <div style={{ padding: '2rem' }}>
            <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '1rem' }}>
                Vendor Details
            </h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
                Update your vendor information
            </p>

            <div style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '2rem',
                maxWidth: '800px'
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500 }}>
                            Vendor Name *
                        </label>
                        <input
                            type="text"
                            value={vendor.name}
                            onChange={e => setVendor({ ...vendor, name: e.target.value })}
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: 'var(--bg-app)',
                                color: 'var(--text-primary)'
                            }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500 }}>
                            Email
                        </label>
                        <input
                            type="email"
                            value={vendor.email || ''}
                            onChange={e => setVendor({ ...vendor, email: e.target.value })}
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: 'var(--bg-app)',
                                color: 'var(--text-primary)'
                            }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500 }}>
                            Password
                        </label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="Leave blank to keep current password"
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: 'var(--bg-app)',
                                color: 'var(--text-primary)'
                            }}
                        />
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                            Leave blank to keep your current password unchanged
                        </p>
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500 }}>
                            Service Types *
                        </label>
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                            {SERVICE_TYPES.map(type => (
                                <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={vendor.serviceTypes?.includes(type)}
                                        onChange={() => toggleServiceType(type)}
                                    />
                                    <span style={{ fontSize: '0.875rem' }}>{type}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500 }}>
                            Delivery Days *
                        </label>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                            gap: '0.5rem',
                            marginTop: '0.5rem'
                        }}>
                            {DAYS_OF_WEEK.map(day => (
                                <label
                                    key={day}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.75rem',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-sm)',
                                        cursor: 'pointer',
                                        backgroundColor: vendor.deliveryDays?.includes(day)
                                            ? 'rgba(59, 130, 246, 0.1)'
                                            : 'transparent'
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={vendor.deliveryDays?.includes(day)}
                                        onChange={() => toggleDay(day)}
                                    />
                                    <span style={{ fontSize: '0.875rem' }}>{day}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={vendor.allowsMultipleDeliveries}
                                onChange={e => setVendor({ ...vendor, allowsMultipleDeliveries: e.target.checked })}
                                disabled={!vendor.deliveryDays || vendor.deliveryDays.length <= 1}
                            />
                            <span style={{ fontSize: '0.875rem' }}>
                                Allow Multiple Deliveries
                                {(!vendor.deliveryDays || vendor.deliveryDays.length <= 1) && (
                                    <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
                                        (Select multiple days to enable)
                                    </span>
                                )}
                            </span>
                        </label>
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500 }}>
                            Minimum Meals
                        </label>
                        <input
                            type="number"
                            value={vendor.minimumMeals || 0}
                            onChange={e => setVendor({ ...vendor, minimumMeals: Number(e.target.value) })}
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: 'var(--bg-app)',
                                color: 'var(--text-primary)'
                            }}
                        />
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                            Minimum meals/value required when ordering from this vendor (0 = no minimum)
                        </p>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.75rem 1.5rem',
                                backgroundColor: 'var(--color-primary)',
                                color: 'white',
                                border: 'none',
                                borderRadius: 'var(--radius-md)',
                                cursor: isSaving ? 'not-allowed' : 'pointer',
                                opacity: isSaving ? 0.7 : 1,
                                fontWeight: 500
                            }}
                        >
                            <Check size={16} />
                            {isSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

