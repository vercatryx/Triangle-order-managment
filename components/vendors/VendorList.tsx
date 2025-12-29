'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Vendor } from '@/lib/types';
import { getVendors } from '@/lib/cached-data';
import { Search, Truck, CheckCircle, XCircle, ChevronRight } from 'lucide-react';
import styles from './VendorList.module.css';

export function VendorList() {
    const router = useRouter();
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadVendors();
    }, []);

    async function loadVendors() {
        setIsLoading(true);
        const data = await getVendors();
        setVendors(data);
        setIsLoading(false);
    }

    const filteredVendors = vendors.filter(v => {
        const matchesSearch = v.name.toLowerCase().includes(search.toLowerCase()) ||
            v.serviceType.toLowerCase().includes(search.toLowerCase()) ||
            v.deliveryDays.some(day => day.toLowerCase().includes(search.toLowerCase()));
        return matchesSearch;
    });

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Vendors</h1>
                </div>
                <div className={styles.loadingContainer}>
                    <div className="spinner"></div>
                    <p>Loading vendors...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Vendors</h1>
            </div>

            <div className={styles.filters}>
                <div className={styles.searchBox}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        className="input"
                        placeholder="Search vendors..."
                        style={{ paddingLeft: '2.5rem', width: '300px' }}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className={styles.list}>
                <div className={styles.listHeader}>
                    <span style={{ minWidth: '250px', flex: 2, paddingRight: '16px' }}>Name</span>
                    <span style={{ minWidth: '120px', flex: 1, paddingRight: '16px' }}>Service Type</span>
                    <span style={{ minWidth: '200px', flex: 2, paddingRight: '16px' }}>Delivery Days</span>
                    <span style={{ minWidth: '150px', flex: 1, paddingRight: '16px' }}>Multiple Deliveries</span>
                    <span style={{ minWidth: '120px', flex: 1, paddingRight: '16px' }}>Minimum Order</span>
                    <span style={{ minWidth: '100px', flex: 0.8, paddingRight: '16px' }}>Status</span>
                </div>
                {filteredVendors.map(vendor => (
                    <div
                        key={vendor.id}
                        className={styles.vendorRow}
                        onClick={() => router.push(`/vendors/${vendor.id}`)}
                        style={{ cursor: 'pointer' }}
                    >
                        <span
                            title={vendor.name}
                            style={{ minWidth: '250px', flex: 2, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}
                        >
                            <Truck size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                            {vendor.name}
                        </span>
                        <span
                            title={vendor.serviceType}
                            style={{ minWidth: '120px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}
                        >
                            <span className="badge badge-info">
                                {vendor.serviceType}
                            </span>
                        </span>
                        <span
                            title={vendor.deliveryDays.join(', ') || 'No delivery days'}
                            style={{ minWidth: '200px', flex: 2, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}
                        >
                            {vendor.deliveryDays.length > 0 ? vendor.deliveryDays.join(', ') : '-'}
                        </span>
                        <span
                            title={vendor.allowsMultipleDeliveries ? 'Allows multiple deliveries' : 'Single delivery only'}
                            style={{ minWidth: '150px', flex: 1, paddingRight: '16px' }}
                        >
                            {vendor.allowsMultipleDeliveries ? (
                                <span style={{ color: 'var(--color-success)' }}>
                                    <CheckCircle size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                    Yes
                                </span>
                            ) : (
                                <span style={{ color: 'var(--text-tertiary)' }}>
                                    <XCircle size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                    No
                                </span>
                            )}
                        </span>
                        <span
                            title={`Minimum order: ${vendor.minimumMeals || 0}`}
                            style={{ minWidth: '120px', flex: 1, fontSize: '0.9rem', color: 'var(--text-secondary)', paddingRight: '16px' }}
                        >
                            {vendor.minimumMeals || 0}
                        </span>
                        <span
                            title={vendor.isActive ? 'Active' : 'Inactive'}
                            style={{ minWidth: '100px', flex: 0.8, paddingRight: '16px' }}
                        >
                            {vendor.isActive ? (
                                <span className="badge badge-success">Active</span>
                            ) : (
                                <span className="badge">Inactive</span>
                            )}
                        </span>
                        <span style={{ width: '40px' }}><ChevronRight size={16} /></span>
                    </div>
                ))}
                {filteredVendors.length === 0 && !isLoading && (
                    <div className={styles.empty}>
                        {search ? 'No vendors found matching your search.' : 'No vendors found.'}
                    </div>
                )}
            </div>
        </div>
    );
}

