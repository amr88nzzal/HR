import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

// Database configuration
const { Pool } = pg;
const dbConfig: pg.PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'hrms_db',
  user: process.env.DB_USER || 'hrms_admin',
  password: process.env.DB_PASSWORD || 'CHANGE_ME',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 4000,
};

// Create connection pool
const pool = new Pool(
  process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : dbConfig
);

// Graceful connection status check
let isDbConnected = false;
let dbLastError: string | null = null;

async function checkDatabaseConnection() {
  try {
    const client = await pool.connect();
    const res = await client.query('SELECT NOW() as current_time, current_database() as db_name');
    client.release();
    isDbConnected = true;
    dbLastError = null;
    return {
      connected: true,
      time: res.rows[0].current_time,
      database: res.rows[0].db_name,
    };
  } catch (err: any) {
    isDbConnected = false;
    dbLastError = err.message || 'Unknown database connection error';
    return {
      connected: false,
      error: dbLastError,
    };
  }
}

// Check on startup
checkDatabaseConnection().then(status => {
  if (status.connected) {
    console.log(`[HRMS DB] Successfully connected to PostgreSQL database: ${status.database}`);
  } else {
    console.warn(`[HRMS DB] PostgreSQL is currently offline/unreachable: ${status.error}`);
  }
});

// --- API ROUTES ---

// 1. Health & Database Status
app.get('/api/db/status', async (_req: Request, res: Response) => {
  const status = await checkDatabaseConnection();
  res.json({
    ...status,
    config: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || '5432',
      database: process.env.DB_NAME || 'hrms_db',
      user: process.env.DB_USER || 'hrms_admin',
    },
  });
});

// 2. Bootstrap: Load all data from PostgreSQL
app.get('/api/bootstrap', async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    try {
      const companies = (await client.query('SELECT * FROM companies')).rows;
      const branches = (await client.query('SELECT * FROM branches ORDER BY is_main DESC, name_ar ASC')).rows;
      const departments = (await client.query('SELECT * FROM departments ORDER BY code ASC')).rows;
      const jobTitles = (await client.query('SELECT * FROM job_titles ORDER BY title_ar ASC')).rows;
      const employees = (await client.query('SELECT * FROM employees ORDER BY employee_no ASC')).rows;
      const leaves = (await client.query('SELECT * FROM leaves ORDER BY start_date DESC')).rows;
      const advances = (await client.query('SELECT * FROM salary_advances ORDER BY request_date DESC')).rows;
      const debts = (await client.query('SELECT * FROM employee_debts ORDER BY invoice_date DESC')).rows;
      const attendance = (await client.query('SELECT * FROM attendance_logs ORDER BY trx_date DESC LIMIT 500')).rows;
      const payroll = (await client.query('SELECT * FROM payroll_runs ORDER BY year DESC, month DESC')).rows;
      const audit = (await client.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 200')).rows;

      res.json({
        success: true,
        source: 'postgresql',
        data: {
          companies,
          branches,
          departments,
          jobTitles,
          employees,
          leaves,
          advances,
          debts,
          attendance,
          payroll,
          audit,
        },
      });
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(500).json({
      success: false,
      source: 'error',
      error: err.message,
    });
  }
});

// 3. Employee CRUD
app.post('/api/employees', async (req: Request, res: Response) => {
  const emp = req.body;
  try {
    const query = `
      INSERT INTO employees (
        id, employee_no, zkteco_id, accounting_ref_no, national_id,
        full_name_ar, full_name_en, email, phone, gender, birth_date,
        nationality, marital_status, dependents_count, branch_id,
        department_id, job_title_id, hire_date, employment_type, status,
        basic_salary, housing_allowance, transport_allowance, phone_allowance,
        bank_name, bank_iban, annual_leave_balance, sick_leave_balance
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
      )
      ON CONFLICT (id) DO UPDATE SET
        employee_no = EXCLUDED.employee_no,
        zkteco_id = EXCLUDED.zkteco_id,
        accounting_ref_no = EXCLUDED.accounting_ref_no,
        national_id = EXCLUDED.national_id,
        full_name_ar = EXCLUDED.full_name_ar,
        full_name_en = EXCLUDED.full_name_en,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        branch_id = EXCLUDED.branch_id,
        department_id = EXCLUDED.department_id,
        job_title_id = EXCLUDED.job_title_id,
        basic_salary = EXCLUDED.basic_salary,
        housing_allowance = EXCLUDED.housing_allowance,
        transport_allowance = EXCLUDED.transport_allowance,
        phone_allowance = EXCLUDED.phone_allowance,
        bank_name = EXCLUDED.bank_name,
        bank_iban = EXCLUDED.bank_iban,
        annual_leave_balance = EXCLUDED.annual_leave_balance,
        sick_leave_balance = EXCLUDED.sick_leave_balance,
        status = EXCLUDED.status
      RETURNING *;
    `;
    const values = [
      emp.id, emp.employeeNo, emp.zktecoId, emp.accountingRefNo, emp.nationalId,
      emp.fullNameAr, emp.fullNameEn || emp.fullNameAr, emp.email, emp.phone,
      emp.gender || 'male', emp.birthDate || null, emp.nationality || 'أردني',
      emp.maritalStatus || 'married', emp.dependentsCount || 0,
      emp.branchId, emp.departmentId, emp.jobTitleId, emp.hireDate || new Date().toISOString().split('T')[0],
      emp.employmentType || 'full_time', emp.status || 'active',
      emp.basicSalary || 0, emp.housingAllowance || 0, emp.transportAllowance || 0,
      emp.phoneAllowance || 0, emp.bankName || '', emp.bankIban || '',
      emp.annualLeaveBalance || 14, emp.sickLeaveBalance || 14
    ];
    const result = await pool.query(query, values);
    res.json({ success: true, employee: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/employees/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Leaves
app.post('/api/leaves', async (req: Request, res: Response) => {
  const leave = req.body;
  try {
    const query = `
      INSERT INTO leaves (id, employee_id, leave_type, start_date, end_date, days_count, reason, status, rejection_reason, approved_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        rejection_reason = EXCLUDED.rejection_reason,
        approved_by = EXCLUDED.approved_by
      RETURNING *;
    `;
    const values = [
      leave.id, leave.employeeId, leave.type || leave.leave_type || 'annual',
      leave.startDate || leave.start_date, leave.endDate || leave.end_date,
      leave.daysCount || leave.days_count || 1, leave.reason || '',
      leave.status || 'pending', leave.rejectionReason || null, leave.approvedBy || null
    ];
    const result = await pool.query(query, values);
    res.json({ success: true, leave: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Advances (Loans)
app.post('/api/loans', async (req: Request, res: Response) => {
  const loan = req.body;
  try {
    const query = `
      INSERT INTO salary_advances (id, employee_id, request_date, total_amount, monthly_installment, remaining_balance, reason, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        remaining_balance = EXCLUDED.remaining_balance,
        status = EXCLUDED.status
      RETURNING *;
    `;
    const values = [
      loan.id, loan.employeeId, loan.requestDate || new Date().toISOString().split('T')[0],
      loan.amount || loan.total_amount, loan.monthlyInstallment || loan.monthly_installment,
      loan.remainingAmount || loan.remaining_balance, loan.reason || '', loan.status || 'approved'
    ];
    const result = await pool.query(query, values);
    res.json({ success: true, loan: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Debts
app.post('/api/debts', async (req: Request, res: Response) => {
  const debt = req.body;
  try {
    const query = `
      INSERT INTO employee_debts (id, employee_id, invoice_number, invoice_date, total_amount, remaining_amount, description, is_settled)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        remaining_amount = EXCLUDED.remaining_amount,
        is_settled = EXCLUDED.is_settled
      RETURNING *;
    `;
    const values = [
      debt.id, debt.employeeId, debt.invoiceNumber || debt.invoice_number,
      debt.invoiceDate || debt.invoice_date, debt.totalAmount || debt.total_amount,
      debt.remainingAmount || debt.remaining_amount, debt.description || '', debt.isSettled || false
    ];
    const result = await pool.query(query, values);
    res.json({ success: true, debt: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Attendance Log insertion (single or batch)
app.post('/api/attendance/logs', async (req: Request, res: Response) => {
  const logs = Array.isArray(req.body) ? req.body : [req.body];
  try {
    for (const item of logs) {
      await pool.query(`
        INSERT INTO attendance_logs (id, company_id, branch_id, department_id, employee_no, zkteco_id, trx_date, trx_type, device_ip)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
      `, [
        item.id || 'log-' + Math.random().toString(36).substring(2, 9),
        item.companyId || 'comp-1',
        item.branchId || 'br-1',
        item.departmentId || 'dept-1',
        item.employeeNo || item.employee_no || '',
        item.zktecoId || item.zkteco_id || '',
        item.trxDate || item.trx_date || new Date(),
        item.trxType || item.trx_type || 'CheckIn',
        item.deviceIp || item.device_ip || '192.168.1.201'
      ]);
    }
    res.json({ success: true, count: logs.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Payroll Run
app.post('/api/payroll', async (req: Request, res: Response) => {
  const p = req.body;
  try {
    const query = `
      INSERT INTO payroll_runs (
        id, month, year, status, total_gross_salary, total_statutory_deductions,
        total_net_before_loans, total_loans_and_debts, total_final_net_payable,
        total_employer_social_security
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        total_gross_salary = EXCLUDED.total_gross_salary,
        total_statutory_deductions = EXCLUDED.total_statutory_deductions,
        total_net_before_loans = EXCLUDED.total_net_before_loans,
        total_loans_and_debts = EXCLUDED.total_loans_and_debts,
        total_final_net_payable = EXCLUDED.total_final_net_payable,
        total_employer_social_security = EXCLUDED.total_employer_social_security
      RETURNING *;
    `;
    const values = [
      p.id, p.month, p.year, p.status || 'draft',
      p.totalGrossSalary || p.total_gross_salary || 0,
      p.totalStatutoryDeductions || p.total_statutory_deductions || 0,
      p.totalNetBeforeLoans || p.total_net_before_loans || 0,
      p.totalLoansAndDebts || p.total_loans_and_debts || 0,
      p.totalFinalNetPayable || p.total_final_net_payable || 0,
      p.totalEmployerSocialSecurity || p.total_employer_social_security || 0
    ];
    const result = await pool.query(query, values);
    res.json({ success: true, payroll: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Sync initial data from frontend to DB
app.post('/api/sync-initial', async (req: Request, res: Response) => {
  const { employees, companies, branches, departments, jobTitles } = req.body;
  try {
    if (companies && companies.length > 0) {
      for (const c of companies) {
        await pool.query(`
          INSERT INTO companies (id, name_ar, name_en, cr_number, tax_number, social_security_number, phone, email, website, address)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (id) DO NOTHING
        `, [c.id, c.nameAr, c.nameEn, c.crNumber, c.taxNumber, c.socialSecurityNumber, c.phone, c.email, c.website, c.address]);
      }
    }
    if (branches && branches.length > 0) {
      for (const b of branches) {
        await pool.query(`
          INSERT INTO branches (id, company_id, name_ar, name_en, city, address, phone, is_main)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO NOTHING
        `, [b.id, b.companyId, b.nameAr, b.nameEn, b.city, b.address, b.phone, b.isMain]);
      }
    }
    if (departments && departments.length > 0) {
      for (const d of departments) {
        await pool.query(`
          INSERT INTO departments (id, branch_id, name_ar, name_en, code, cost_center_code)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO NOTHING
        `, [d.id, d.branchId, d.nameAr, d.nameEn, d.code, d.costCenterCode]);
      }
    }
    if (jobTitles && jobTitles.length > 0) {
      for (const j of jobTitles) {
        await pool.query(`
          INSERT INTO job_titles (id, department_id, title_ar, title_en, grade)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO NOTHING
        `, [j.id, j.departmentId, j.titleAr, j.titleEn, j.grade]);
      }
    }
    res.json({ success: true, message: 'Initial data synced successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- VITE & STATIC SERVING ---
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`[HRMS Server] Running on http://localhost:${PORT} in ${isProd ? 'production' : 'development'} mode`);
  });
}

startServer();
