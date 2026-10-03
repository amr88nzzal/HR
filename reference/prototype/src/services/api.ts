/**
 * HRMS PostgreSQL API & Hybrid Synchronization Service
 */

export interface DatabaseStatus {
  connected: boolean;
  database?: string;
  time?: string;
  error?: string;
  config?: {
    host: string;
    port: string;
    database: string;
    user: string;
  };
}

class ApiService {
  private isConnectedToPg = false;
  private statusListeners: ((status: DatabaseStatus) => void)[] = [];
  private lastStatus: DatabaseStatus = { connected: false };

  constructor() {
    this.checkStatus();
  }

  public subscribeStatus(listener: (status: DatabaseStatus) => void) {
    this.statusListeners.push(listener);
    listener(this.lastStatus);
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== listener);
    };
  }

  private notify(status: DatabaseStatus) {
    this.lastStatus = status;
    this.isConnectedToPg = status.connected;
    this.statusListeners.forEach(listener => listener(status));
  }

  public async checkStatus(): Promise<DatabaseStatus> {
    try {
      const res = await fetch('/api/db/status');
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data: DatabaseStatus = await res.json();
      this.notify(data);
      return data;
    } catch (err: any) {
      const status: DatabaseStatus = {
        connected: false,
        error: err.message || 'فشل الاتصال بخادم الـ API أو قاعدة البيانات'
      };
      this.notify(status);
      return status;
    }
  }

  public isPgActive(): boolean {
    return this.isConnectedToPg;
  }

  public async getBootstrapData(): Promise<any | null> {
    try {
      const res = await fetch('/api/bootstrap');
      if (!res.ok) return null;
      const json = await res.json();
      if (json.success && json.data) {
        return json.data;
      }
      return null;
    } catch {
      return null;
    }
  }

  public async saveEmployee(emp: any): Promise<boolean> {
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emp),
      });
      const data = await res.json();
      return !!data.success;
    } catch {
      return false;
    }
  }

  public async deleteEmployee(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/employees/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      return !!data.success;
    } catch {
      return false;
    }
  }

  public async saveLeave(leave: any): Promise<boolean> {
    try {
      const res = await fetch('/api/leaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leave),
      });
      const data = await res.json();
      return !!data.success;
    } catch {
      return false;
    }
  }

  public async saveLoan(loan: any): Promise<boolean> {
    try {
      const res = await fetch('/api/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loan),
      });
      const data = await res.json();
      return !!data.success;
    } catch {
      return false;
    }
  }

  public async saveDebt(debt: any): Promise<boolean> {
    try {
      const res = await fetch('/api/debts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(debt),
      });
      const data = await res.json();
      return !!data.success;
    } catch {
      return false;
    }
  }

  public async saveAttendanceLogs(logs: any[]): Promise<boolean> {
    try {
      const res = await fetch('/api/attendance/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logs),
      });
      const data = await res.json();
      return !!data.success;
    } catch {
      return false;
    }
  }

  public async savePayrollRun(payroll: any): Promise<boolean> {
    try {
      const res = await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payroll),
      });
      const data = await res.json();
      return !!data.success;
    } catch {
      return false;
    }
  }

  public async syncInitialData(data: any): Promise<boolean> {
    try {
      const res = await fetch('/api/sync-initial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const resJson = await res.json();
      return !!resJson.success;
    } catch {
      return false;
    }
  }
}

export const apiService = new ApiService();
