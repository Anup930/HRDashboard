// === GRETEX WFH TRACKER - API WRAPPER ===
const API = {
  async call(action, payload = {}) {
    try {
      const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        mode: 'cors',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, payload })
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        throw new Error('Server returned invalid response: ' + text.slice(0, 120));
      }
      if (!data.success) throw new Error(data.error || 'Request failed');
      return data;
    } catch (err) {
      console.error(`API error [${action}]:`, err);
      throw err;
    }
  },

  login: (email, password) => API.call('login', { email, password }),
  getDashboard: (date) => API.call('getDashboard', { date }),

  getEmployees: () => API.call('getEmployees'),
  addEmployee: (payload) => API.call('addEmployee', payload),
  updateEmployee: (payload) => API.call('updateEmployee', payload),

  getSchedules: () => API.call('getSchedules'),
  addSchedule: (payload) => API.call('addSchedule', payload),
  updateScheduleStatus: (payload) => API.call('updateScheduleStatus', payload),

  getCheckpoints: () => API.call('getCheckpoints'),
  addCheckpoint: (payload) => API.call('addCheckpoint', payload),
  updateCheckpoint: (payload) => API.call('updateCheckpoint', payload),

  getVerificationSheet: (date) => API.call('getVerificationSheet', { date }),
  saveTransaction: (payload) => API.call('saveTransaction', payload),

  getUsers: () => API.call('getUsers'),
  addUser: (payload) => API.call('addUser', payload),
  updateUserStatus: (payload) => API.call('updateUserStatus', payload),

  getEmployeeReport: (payload) => API.call('getEmployeeReport', payload)
};

// === SESSION HELPERS ===
const Session = {
  KEY: 'gretex_wfh_session',
  save(user) {
    sessionStorage.setItem(this.KEY, JSON.stringify(user));
  },
  get() {
    const raw = sessionStorage.getItem(this.KEY);
    return raw ? JSON.parse(raw) : null;
  },
  clear() {
    sessionStorage.removeItem(this.KEY);
  }
};