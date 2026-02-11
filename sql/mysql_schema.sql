-- MySQL schema for Triangle Order Management
-- Migrated from PostgreSQL (Supabase)
-- Run this after creating the database: CREATE DATABASE triangle_orders;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- order_number sequence simulation (MySQL doesn't have sequences)
CREATE TABLE IF NOT EXISTS order_number_seq (
    next_val BIGINT DEFAULT 100001
);
INSERT IGNORE INTO order_number_seq (next_val) VALUES (100001);

-- client_statuses
CREATE TABLE IF NOT EXISTS client_statuses (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    is_system_default BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deliveries_allowed BOOLEAN DEFAULT TRUE,
    requires_units_on_change BOOLEAN DEFAULT FALSE
);

-- vendors
CREATE TABLE IF NOT EXISTS vendors (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name TEXT NOT NULL,
    service_type VARCHAR(50) NOT NULL,
    delivery_days JSON DEFAULT ('[]'),
    delivery_frequency VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    minimum_order INT DEFAULT 0 NOT NULL,
    minimum_meals INT DEFAULT 0 NOT NULL,
    email TEXT,
    password TEXT,
    cutoff_hours INT DEFAULT 0
);

-- item_categories
CREATE TABLE IF NOT EXISTS item_categories (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    set_value DECIMAL(10,2),
    sort_order INT DEFAULT 0
);

-- box_types
CREATE TABLE IF NOT EXISTS box_types (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    vendor_id CHAR(36),
    is_active BOOLEAN DEFAULT TRUE,
    price_each DECIMAL(10,2) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- box_quotas
CREATE TABLE IF NOT EXISTS box_quotas (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    box_type_id CHAR(36) NOT NULL,
    category_id CHAR(36) NOT NULL,
    target_value DECIMAL(10,2) NOT NULL
);

-- locations
CREATE TABLE IF NOT EXISTS locations (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- vendor_locations
CREATE TABLE IF NOT EXISTS vendor_locations (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    vendor_id CHAR(36) NOT NULL,
    location_id CHAR(36) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- navigators
CREATE TABLE IF NOT EXISTS navigators (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    email TEXT,
    password TEXT
);

-- nutritionists
CREATE TABLE IF NOT EXISTS nutritionists (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- admins
CREATE TABLE IF NOT EXISTS admins (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    username VARCHAR(255) NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL,
    name VARCHAR(255)
);

-- app_settings
CREATE TABLE IF NOT EXISTS app_settings (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    weekly_cutoff_day VARCHAR(50) NOT NULL,
    weekly_cutoff_time VARCHAR(50) NOT NULL,
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()),
    report_email TEXT,
    enable_passwordless_login BOOLEAN DEFAULT FALSE
);

-- equipment
CREATE TABLE IF NOT EXISTS equipment (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL,
    updated_at DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL
);

-- clients
CREATE TABLE IF NOT EXISTS clients (
    id VARCHAR(255) PRIMARY KEY,
    full_name TEXT NOT NULL,
    address TEXT,
    phone_number TEXT,
    navigator_id CHAR(36),
    end_date VARCHAR(50),
    screening_took_place BOOLEAN DEFAULT FALSE,
    screening_signed BOOLEAN DEFAULT FALSE,
    notes TEXT,
    status_id CHAR(36),
    service_type VARCHAR(50) NOT NULL,
    approved_meals_per_week INT DEFAULT 0,
    active_order JSON DEFAULT ('{}'),
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()),
    updated_at DATETIME DEFAULT (UTC_TIMESTAMP()),
    email TEXT,
    screening_status VARCHAR(50) DEFAULT 'not_started',
    parent_client_id VARCHAR(255),
    secondary_phone_number TEXT,
    authorized_amount DECIMAL(10,2),
    expiration_date DATE,
    dob DATE,
    cin VARCHAR(50),
    location_id CHAR(36),
    order_history JSON DEFAULT ('[]'),
    upcoming_order JSON
);

-- menu_items
CREATE TABLE IF NOT EXISTS menu_items (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    vendor_id CHAR(36),
    name TEXT NOT NULL,
    value INT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()),
    category_id CHAR(36),
    quota_value DECIMAL(10,2) DEFAULT 1,
    minimum_order INT DEFAULT 0 NOT NULL,
    price_each DECIMAL(10,2),
    image_url TEXT,
    sort_order INT DEFAULT 0,
    focus_x DECIMAL(5,2) DEFAULT 50.00,
    focus_y DECIMAL(5,2) DEFAULT 50.00,
    notes_enabled BOOLEAN DEFAULT FALSE,
    delivery_days JSON
);

-- breakfast_categories
CREATE TABLE IF NOT EXISTS breakfast_categories (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    set_value DECIMAL(10,2),
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL,
    meal_type VARCHAR(50) DEFAULT 'Breakfast' NOT NULL,
    sort_order INT DEFAULT 0
);

-- breakfast_items
CREATE TABLE IF NOT EXISTS breakfast_items (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    category_id CHAR(36),
    name TEXT NOT NULL,
    quota_value DECIMAL(10,2) DEFAULT 1,
    price_each DECIMAL(10,2),
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL,
    sort_order INT DEFAULT 0,
    image_url TEXT,
    focus_x DECIMAL(5,2) DEFAULT 50.00,
    focus_y DECIMAL(5,2) DEFAULT 50.00,
    notes_enabled BOOLEAN DEFAULT FALSE,
    vendor_id CHAR(36)
);

-- meal_items: view for breakfast_items (Breakfast/Lunch/Dinner items share same structure)
DROP VIEW IF EXISTS meal_items;
CREATE VIEW meal_items AS SELECT * FROM breakfast_items;

-- passwordless_codes
CREATE TABLE IF NOT EXISTS passwordless_codes (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    attempts INT DEFAULT 0
);

-- orders (order_number is set by app via max+1)
CREATE TABLE IF NOT EXISTS orders (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    client_id VARCHAR(255) NOT NULL,
    service_type VARCHAR(50) NOT NULL,
    case_id TEXT,
    status VARCHAR(50) DEFAULT 'pending' NOT NULL,
    last_updated DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL,
    updated_by TEXT,
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL,
    scheduled_delivery_date DATE,
    actual_delivery_date DATE,
    delivery_distribution JSON,
    total_value DECIMAL(10,2) DEFAULT 0,
    total_items INT DEFAULT 0,
    notes TEXT,
    delivery_proof_url TEXT,
    order_number BIGINT NOT NULL,
    order_number_text VARCHAR(20) GENERATED ALWAYS AS (CAST(order_number AS CHAR)) STORED,
    billing_notes TEXT,
    creation_id INT,
    UNIQUE KEY uk_order_number (order_number)
);

-- order_vendor_selections
CREATE TABLE IF NOT EXISTS order_vendor_selections (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    order_id CHAR(36) NOT NULL,
    vendor_id CHAR(36),
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL
);

-- order_items
CREATE TABLE IF NOT EXISTS order_items (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    order_id CHAR(36) NOT NULL,
    vendor_selection_id CHAR(36) NOT NULL,
    menu_item_id CHAR(36),
    quantity INT NOT NULL,
    unit_value DECIMAL(10,2) NOT NULL,
    total_value DECIMAL(10,2) NOT NULL,
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL,
    meal_item_id CHAR(36),
    custom_name TEXT,
    custom_price DECIMAL(10,2),
    notes TEXT
);

-- order_box_selections
CREATE TABLE IF NOT EXISTS order_box_selections (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    order_id CHAR(36) NOT NULL,
    vendor_id CHAR(36),
    quantity INT NOT NULL,
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL,
    unit_value DECIMAL(10,2) DEFAULT 0,
    total_value DECIMAL(10,2) DEFAULT 0,
    items JSON DEFAULT ('{}'),
    box_type_id CHAR(36)
);

-- billing_records
CREATE TABLE IF NOT EXISTS billing_records (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    client_id VARCHAR(255),
    client_name TEXT,
    status VARCHAR(50) NOT NULL,
    remarks TEXT,
    navigator TEXT,
    amount DECIMAL(10,2) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    order_id CHAR(36)
);

-- delivery_history
CREATE TABLE IF NOT EXISTS delivery_history (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    client_id VARCHAR(255),
    vendor_id CHAR(36),
    service_type VARCHAR(50) NOT NULL,
    delivery_date DATETIME NOT NULL,
    items_summary TEXT,
    proof_of_delivery_image TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- order_history
CREATE TABLE IF NOT EXISTS order_history (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    client_id VARCHAR(255),
    who TEXT NOT NULL,
    summary TEXT NOT NULL,
    `timestamp` DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- navigator_logs
CREATE TABLE IF NOT EXISTS navigator_logs (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    navigator_id CHAR(36) NOT NULL,
    client_id VARCHAR(255) NOT NULL,
    old_status TEXT,
    new_status TEXT,
    units_added INT DEFAULT 0,
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL
);

-- forms
CREATE TABLE IF NOT EXISTS forms (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- questions
CREATE TABLE IF NOT EXISTS questions (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    form_id CHAR(36) NOT NULL,
    text TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    options JSON,
    `order` INT DEFAULT 0 NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    conditional_text_inputs JSON
);

-- filled_forms
CREATE TABLE IF NOT EXISTS filled_forms (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    form_id CHAR(36) NOT NULL,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- form_answers
CREATE TABLE IF NOT EXISTS form_answers (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    filled_form_id CHAR(36) NOT NULL,
    question_id CHAR(36) NOT NULL,
    value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- form_submissions
CREATE TABLE IF NOT EXISTS form_submissions (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    form_id CHAR(36) NOT NULL,
    client_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending' NOT NULL,
    data JSON DEFAULT ('{}') NOT NULL,
    signature_url TEXT,
    pdf_url TEXT,
    token CHAR(36) DEFAULT (UUID()) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    comments TEXT
);

-- client_food_orders
CREATE TABLE IF NOT EXISTS client_food_orders (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    client_id VARCHAR(255) NOT NULL,
    case_id TEXT,
    delivery_day_orders JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by CHAR(36)
);

-- client_meal_orders
CREATE TABLE IF NOT EXISTS client_meal_orders (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    client_id VARCHAR(255) NOT NULL,
    case_id TEXT,
    meal_selections JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by CHAR(36)
);

-- client_box_orders
CREATE TABLE IF NOT EXISTS client_box_orders (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    client_id VARCHAR(255) NOT NULL,
    case_id TEXT,
    box_type_id VARCHAR(255),
    vendor_id VARCHAR(255),
    quantity INT DEFAULT 1,
    items JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by CHAR(36),
    item_notes JSON
);

-- upcoming_orders
CREATE TABLE IF NOT EXISTS upcoming_orders (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    client_id VARCHAR(255) NOT NULL,
    service_type VARCHAR(50) NOT NULL,
    case_id TEXT,
    status VARCHAR(50) DEFAULT 'scheduled' NOT NULL,
    last_updated DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL,
    updated_by VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL,
    take_effect_date DATE,
    total_value DECIMAL(10,2) DEFAULT 0,
    total_items INT DEFAULT 0,
    notes TEXT,
    processed_order_id CHAR(36),
    processed_at DATETIME,
    delivery_day VARCHAR(50),
    order_number BIGINT,
    meal_type VARCHAR(50) DEFAULT 'Lunch'
);

-- upcoming_order_vendor_selections
CREATE TABLE IF NOT EXISTS upcoming_order_vendor_selections (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    upcoming_order_id CHAR(36) NOT NULL,
    vendor_id CHAR(36),
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL
);

-- upcoming_order_items
CREATE TABLE IF NOT EXISTS upcoming_order_items (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    upcoming_order_id CHAR(36) NOT NULL,
    vendor_selection_id CHAR(36) NOT NULL,
    menu_item_id CHAR(36),
    quantity INT NOT NULL,
    unit_value DECIMAL(10,2) NOT NULL,
    total_value DECIMAL(10,2) NOT NULL,
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL,
    meal_item_id CHAR(36),
    notes TEXT,
    custom_name TEXT,
    custom_price DECIMAL(10,2)
);

-- upcoming_order_box_selections
CREATE TABLE IF NOT EXISTS upcoming_order_box_selections (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    upcoming_order_id CHAR(36) NOT NULL,
    vendor_id CHAR(36),
    quantity INT NOT NULL,
    created_at DATETIME DEFAULT (UTC_TIMESTAMP()) NOT NULL,
    unit_value DECIMAL(10,2) DEFAULT 0,
    total_value DECIMAL(10,2) DEFAULT 0,
    items JSON DEFAULT ('{}')
);

SET FOREIGN_KEY_CHECKS = 1;
