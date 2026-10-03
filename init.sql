-- ============================================================
-- HRMS PostgreSQL Initial Database Schema & Seed Data
-- Database: hrms_db
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. الشركات (Companies)
CREATE TABLE IF NOT EXISTS companies (
    id VARCHAR(50) PRIMARY KEY,
    name_ar VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    cr_number VARCHAR(100),
    tax_number VARCHAR(100),
    social_security_number VARCHAR(100),
    phone VARCHAR(50),
    email VARCHAR(100),
    website VARCHAR(150),
    address TEXT,
    country VARCHAR(100) DEFAULT 'الأردن',
    currency VARCHAR(10) DEFAULT 'JOD',
    currency_symbol VARCHAR(10) DEFAULT 'د.أ',
    currency_decimals INT DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. الفروع (Branches)
CREATE TABLE IF NOT EXISTS branches (
    id VARCHAR(50) PRIMARY KEY,
    company_id VARCHAR(50) REFERENCES companies(id) ON DELETE CASCADE,
    name_ar VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    is_main BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. الأقسام (Departments)
CREATE TABLE IF NOT EXISTS departments (
    id VARCHAR(50) PRIMARY KEY,
    branch_id VARCHAR(50) REFERENCES branches(id) ON DELETE CASCADE,
    name_ar VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    cost_center_code VARCHAR(50) NOT NULL,
    manager_id VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. المسميات الوظيفية (Job Titles)
CREATE TABLE IF NOT EXISTS job_titles (
    id VARCHAR(50) PRIMARY KEY,
    department_id VARCHAR(50) REFERENCES departments(id) ON DELETE CASCADE,
    title_ar VARCHAR(255) NOT NULL,
    title_en VARCHAR(255) NOT NULL,
    grade VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. الموظفون (Employees)
CREATE TABLE IF NOT EXISTS employees (
    id VARCHAR(50) PRIMARY KEY,
    employee_no VARCHAR(50) NOT NULL UNIQUE,
    zkteco_id VARCHAR(50) NOT NULL,
    accounting_ref_no VARCHAR(50) NOT NULL,
    national_id VARCHAR(50) NOT NULL UNIQUE,
    full_name_ar VARCHAR(255) NOT NULL,
    full_name_en VARCHAR(255) NOT NULL,
    email VARCHAR(150),
    phone VARCHAR(50),
    gender VARCHAR(10) DEFAULT 'male',
    birth_date DATE,
    nationality VARCHAR(100) DEFAULT 'أردني',
    marital_status VARCHAR(20) DEFAULT 'married',
    dependents_count INT DEFAULT 0,
    branch_id VARCHAR(50) REFERENCES branches(id),
    department_id VARCHAR(50) REFERENCES departments(id),
    job_title_id VARCHAR(50) REFERENCES job_titles(id),
    hire_date DATE NOT NULL,
    employment_type VARCHAR(50) DEFAULT 'full_time',
    status VARCHAR(50) DEFAULT 'active',
    basic_salary NUMERIC(15, 3) NOT NULL DEFAULT 0,
    housing_allowance NUMERIC(15, 3) DEFAULT 0,
    transport_allowance NUMERIC(15, 3) DEFAULT 0,
    phone_allowance NUMERIC(15, 3) DEFAULT 0,
    other_allowances NUMERIC(15, 3) DEFAULT 0,
    bank_name VARCHAR(100),
    bank_iban VARCHAR(50),
    is_subject_to_social_security BOOLEAN DEFAULT true,
    is_subject_to_income_tax BOOLEAN DEFAULT true,
    annual_leave_balance NUMERIC(5, 1) DEFAULT 14,
    sick_leave_balance NUMERIC(5, 1) DEFAULT 14,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. الإجازات والمغادرات (Leaves)
CREATE TABLE IF NOT EXISTS leaves (
    id VARCHAR(50) PRIMARY KEY,
    employee_id VARCHAR(50) REFERENCES employees(id) ON DELETE CASCADE,
    leave_type VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days_count NUMERIC(5, 1) NOT NULL,
    reason TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    rejection_reason TEXT,
    approved_by VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. سجلات البصمة والحضور (Attendance Logs - ZKTeco format compatible)
CREATE TABLE IF NOT EXISTS attendance_logs (
    id VARCHAR(50) PRIMARY KEY,
    company_id VARCHAR(50),
    branch_id VARCHAR(50),
    department_id VARCHAR(50),
    employee_no VARCHAR(50),
    zkteco_id VARCHAR(50),
    trx_date TIMESTAMP NOT NULL,
    trx_type VARCHAR(20) NOT NULL, -- CheckIn, CheckOut, BreakIn, BreakOut
    device_ip VARCHAR(50) DEFAULT '192.168.1.201',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. كشوفات الرواتب الشهرية (Payroll Runs)
CREATE TABLE IF NOT EXISTS payroll_runs (
    id VARCHAR(50) PRIMARY KEY,
    month INT NOT NULL,
    year INT NOT NULL,
    status VARCHAR(50) DEFAULT 'draft', -- draft, reviewed, approved, paid
    total_gross_salary NUMERIC(15, 3) NOT NULL DEFAULT 0,
    total_statutory_deductions NUMERIC(15, 3) NOT NULL DEFAULT 0,
    total_net_before_loans NUMERIC(15, 3) NOT NULL DEFAULT 0,
    total_loans_and_debts NUMERIC(15, 3) NOT NULL DEFAULT 0,
    total_final_net_payable NUMERIC(15, 3) NOT NULL DEFAULT 0,
    total_employer_social_security NUMERIC(15, 3) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. السلف والذمم (Advances & Debts)
CREATE TABLE IF NOT EXISTS salary_advances (
    id VARCHAR(50) PRIMARY KEY,
    employee_id VARCHAR(50) REFERENCES employees(id) ON DELETE CASCADE,
    request_date DATE NOT NULL,
    total_amount NUMERIC(15, 3) NOT NULL,
    monthly_installment NUMERIC(15, 3) NOT NULL,
    remaining_balance NUMERIC(15, 3) NOT NULL,
    reason TEXT,
    status VARCHAR(50) DEFAULT 'approved',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employee_debts (
    id VARCHAR(50) PRIMARY KEY,
    employee_id VARCHAR(50) REFERENCES employees(id) ON DELETE CASCADE,
    invoice_number VARCHAR(100) NOT NULL,
    invoice_date DATE NOT NULL,
    total_amount NUMERIC(15, 3) NOT NULL,
    remaining_amount NUMERIC(15, 3) NOT NULL,
    description TEXT,
    is_settled BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. سجل التدقيق والمطابقة (Audit Logs)
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50),
    user_name VARCHAR(150),
    action VARCHAR(100) NOT NULL,
    entity VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100),
    details TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Seeding Initial Demo Data
-- ============================================================

INSERT INTO companies (id, name_ar, name_en, cr_number, tax_number, social_security_number, phone, email, website, address, currency, currency_symbol, currency_decimals)
VALUES ('comp-1', 'مجموعة الأفق الذكية للتكنولوجيا والاستثمار', 'Horizon Smart Tech Group', 'CR-2018-99432', 'TAX-982341-JO', 'SSC-5521098', '+962 6 550 1234', 'info@horizongroup.jo', 'https://horizongroup.jo', 'عمان، الشميساني - شارع الملكة نور، مجمع الأفق التجاري', 'JOD', 'د.أ', 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO branches (id, company_id, name_ar, name_en, city, address, phone, is_main) VALUES
('br-1', 'comp-1', 'الفرع الرئيسي - عمان', 'Amman Main Branch', 'عمان', 'الشميساني، مجمع الأفق، الطابق 4', '+962 6 550 1234', true),
('br-2', 'comp-1', 'فرع إربد الشمالي', 'Irbid North Branch', 'إربد', 'شارع الجامعة، مجمع القيروان', '+962 2 720 5566', false),
('br-3', 'comp-1', 'فرع العقبة الاقتصادي', 'Aqaba Special Branch', 'العقبة', 'المنطقة السكنية الثامنة', '+962 3 201 9988', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO departments (id, branch_id, name_ar, name_en, code, cost_center_code) VALUES
('dept-1', 'br-1', 'إدارة الموارد البشرية والعمليات', 'Human Resources & Operations', 'HR-01', 'CC-1010'),
('dept-2', 'br-1', 'الدائرة المالية والمحاسبة', 'Finance & Accounting', 'FIN-02', 'CC-2020'),
('dept-3', 'br-1', 'تكنولوجيا المعلومات والبرمجيات', 'Information Technology', 'IT-03', 'CC-3030'),
('dept-4', 'br-1', 'المبيعات والتسويق الرقمي', 'Sales & Marketing', 'SALES-04', 'CC-4040')
ON CONFLICT (id) DO NOTHING;

INSERT INTO job_titles (id, department_id, title_ar, title_en, grade) VALUES
('job-1', 'dept-1', 'مدير الموارد البشرية', 'HR Manager', 'M1'),
('job-2', 'dept-2', 'رئيس الحسابات والرواتب', 'Payroll & Chief Accountant', 'M2'),
('job-3', 'dept-3', 'كبير مهندسي البرمجيات', 'Senior Software Engineer', 'A1'),
('job-4', 'dept-4', 'مسؤول مبيعات أول', 'Senior Account Executive', 'B1'),
('job-5', 'dept-1', 'أخصائي شؤون موظفين', 'HR Specialist', 'B2')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, employee_no, zkteco_id, accounting_ref_no, national_id, full_name_ar, full_name_en, email, phone, gender, birth_date, nationality, marital_status, dependents_count, branch_id, department_id, job_title_id, hire_date, basic_salary, housing_allowance, transport_allowance, phone_allowance, bank_name, bank_iban, annual_leave_balance, sick_leave_balance) VALUES
('emp-1', 'EMP-101', '101', 'ACC-5001', '9851029384', 'أحمد عبدالله حسام التميمي', 'Ahmad Abdullah Al-Tamimi', 'ahmad.t@horizongroup.jo', '0795551234', 'male', '1985-04-12', 'أردني', 'married', 3, 'br-1', 'dept-1', 'job-1', '2019-03-01', 1450.000, 250.000, 100.000, 50.000, 'البنك العربي', 'JO82ARAB0000000123456789012345', 18.5, 14.0),
('emp-2', 'EMP-102', '102', 'ACC-5002', '9902049182', 'سارة خالد عبدالرحمن النجار', 'Sara Khalid Al-Najjar', 'sara.n@horizongroup.jo', '0786665432', 'female', '1990-08-20', 'أردنية', 'single', 0, 'br-1', 'dept-2', 'job-2', '2020-07-15', 1200.000, 150.000, 80.000, 30.000, 'بنك الاتحاد', 'JO19UBSI0000000987654321098765', 14.0, 12.0),
('emp-3', 'EMP-103', '103', 'ACC-5003', '9931084729', 'عمر محمود إبراهيم الزعبي', 'Omar Mahmoud Al-Zoubi', 'omar.z@horizongroup.jo', '0777778901', 'male', '1993-11-05', 'أردني', 'married', 2, 'br-1', 'dept-3', 'job-3', '2021-01-10', 1600.000, 200.000, 120.000, 50.000, 'بنك الإسكان للتجارة والتمويل', 'JO44HBTF0000000554433221100998', 11.0, 14.0),
('emp-4', 'EMP-104', '104', 'ACC-5004', '9952093847', 'ليلى يوسف ناصر حداد', 'Layla Yousef Haddad', 'layla.h@horizongroup.jo', '0791112233', 'female', '1995-02-14', 'أردنية', 'single', 0, 'br-1', 'dept-4', 'job-4', '2022-09-01', 850.000, 100.000, 60.000, 25.000, 'كابيتال بنك', 'JO65EXBK0000000778899001122334', 14.0, 14.0),
('emp-5', 'EMP-105', '105', 'ACC-5005', '9971038475', 'فيصل زياد طلال العمري', 'Faisal Ziad Al-Omari', 'faisal.o@horizongroup.jo', '0789998877', 'male', '1997-06-30', 'أردني', 'single', 0, 'br-2', 'dept-3', 'job-3', '2023-04-16', 950.000, 120.000, 70.000, 30.000, 'بنك القاهرة عمان', 'JO33CABK0000000332211445566778', 12.5, 14.0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO salary_advances (id, employee_id, request_date, total_amount, monthly_installment, remaining_balance, reason, status) VALUES
('adv-1', 'emp-3', '2026-08-01', 600.000, 100.000, 400.000, 'مصاريف زواج عائلية', 'approved'),
('adv-2', 'emp-5', '2026-09-10', 300.000, 50.000, 250.000, 'صيانة سيارة شخصية', 'approved')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employee_debts (id, employee_id, invoice_number, invoice_date, total_amount, remaining_amount, description, is_settled) VALUES
('debt-1', 'emp-1', 'INV-2026-881', '2026-09-15', 75.000, 75.000, 'استرداد قيمة تذكرة سفر ملغاة لرحلة عمل', false),
('debt-2', 'emp-4', 'INV-2026-904', '2026-09-22', 45.000, 45.000, 'مشتريات ملحقات حاسوب محمولة شخصية', false)
ON CONFLICT (id) DO NOTHING;
