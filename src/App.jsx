import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import './App.css';

const MENU_ITEMS = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: '▣' },
  { id: 'centers', label: 'المراكز', icon: '🏢' },
  { id: 'items', label: 'الأصناف', icon: '📦' },
  { id: 'needs', label: 'الاحتياجات', icon: '🧮' },
  { id: 'inventory', label: 'المخزون', icon: '📊' },
  { id: 'distributions', label: 'التوزيع', icon: '🚚' },
  { id: 'reports', label: 'التقارير', icon: '📑' },
  { id: 'activity', label: 'سجل العمليات', icon: '📝' },
  { id: 'settings', label: 'الإعدادات', icon: '⚙️' },
];

const initialCenterForm = {
  name: '',
  code: '',
  sector_id: '',
  people_count: '',
  notes: '',
  status: 'active',
};

const initialSectorForm = {
  name: '',
  code: '',
  notes: '',
  status: 'active',
};

const initialPersonForm = {
  name: '',
  code: '',
  center_id: '',
  notes: '',
  status: 'active',
};

const initialItemForm = {
  name: '',
  code: '',
  category: '',
  unit: 'كيلوجرام',
  quantity_per_person: '',
  min_stock: '',
  notes: '',
  status: 'active',
};

const initialTransactionForm = {
  item_id: '',
  type: 'incoming',
  quantity: '',
  unit: '',
  date: new Date().toISOString().slice(0, 10),
  source: '',
  invoice_no: '',
  notes: '',
  center_id: '',
  person_name: '',
};

const initialDistributionForm = {
  center_id: '',
  item_id: '',
  quantity: '',
  date: new Date().toISOString().slice(0, 10),
  responsible: '',
  notes: '',
};

const initialSettingsForm = {
  company_name: 'نظام إدارة الاحتياجات',
  currency: 'ريال',
  alert_threshold: 20,
  report_footer: 'مستند صادر من نظام إدارة الاحتياجات',
};

function formatNumber(value, digits = 2) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0';
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(num);
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return value;
  }
}

function exportCsv(rows, filename) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(',')]
    .concat(
      rows.map((row) =>
        headers
          .map((header) => `"${String(row[header] ?? '').replace(/"/g, '""')}"`)
          .join(','),
      ),
    )
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportExcel(rows, filename) {
  if (!rows.length) return;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'التقرير');
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');

  const [dashboard, setDashboard] = useState({
    summary: {},
    needsByItem: [],
    centerBreakdown: [],
    shortages: [],
    recentActivity: [],
  });
  const [sectors, setSectors] = useState([]);
  const [centers, setCenters] = useState([]);
  const [people, setPeople] = useState([]);
  const [items, setItems] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [distributions, setDistributions] = useState([]);
  const [activity, setActivity] = useState([]);
  const [settings, setSettings] = useState(initialSettingsForm);
  const [reports, setReports] = useState({ needsReport: [], inventoryReport: [], transactions: [] });

  const [centerForm, setCenterForm] = useState(initialCenterForm);
  const [sectorForm, setSectorForm] = useState(initialSectorForm);
  const [personForm, setPersonForm] = useState(initialPersonForm);
  const [itemForm, setItemForm] = useState(initialItemForm);
  const [transactionForm, setTransactionForm] = useState(initialTransactionForm);
  const [distributionForm, setDistributionForm] = useState(initialDistributionForm);
  const [settingsForm, setSettingsForm] = useState(initialSettingsForm);

  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [centerModalOpen, setCenterModalOpen] = useState(false);
  const [sectorModalOpen, setSectorModalOpen] = useState(false);
  const [personModalOpen, setPersonModalOpen] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingCenterId, setEditingCenterId] = useState(null);
  const [editingSectorId, setEditingSectorId] = useState(null);
  const [editingPersonId, setEditingPersonId] = useState(null);
  const [editingItemId, setEditingItemId] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedSectorId, setSelectedSectorId] = useState('all');
  const [reportCenterId, setReportCenterId] = useState('all');
  const [reportItemId, setReportItemId] = useState('all');

  const apiRequest = async (path, method = 'GET', body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'حدث خطأ في الطلب');
    }
    return data;
  };

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken('');
    setUser(null);
    setCurrentPage('dashboard');
  };

  const loadAllData = async () => {
    try {
      setLoading(true);
      const [dashboardData, sectorsData, centersData, peopleData, itemsData, inventoryData, distributionsData, activityData, settingsData, reportsData] = await Promise.all([
        apiRequest('/dashboard'),
        apiRequest('/sectors'),
        apiRequest('/centers'),
        apiRequest('/people'),
        apiRequest('/items'),
        apiRequest('/inventory'),
        apiRequest('/distributions'),
        apiRequest('/activity'),
        apiRequest('/settings'),
        apiRequest('/reports'),
      ]);

      setDashboard(dashboardData);
      setSectors(sectorsData);
      setCenters(centersData);
      setPeople(peopleData);
      setItems(itemsData);
      setInventory(inventoryData);
      setDistributions(distributionsData);
      setActivity(activityData);
      setSettings(settingsData);
      setSettingsForm(settingsData || initialSettingsForm);
      setReports(reportsData || { needsReport: [], inventoryReport: [], transactions: [] });
    } catch (error) {
      showToast(error.message || 'حدث خطأ في تحميل البيانات');
      if (error.message.includes('غير مصرح') || error.message.includes('غير صالح')) {
        logout();
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }

    apiRequest('/auth/session')
      .then((result) => {
        setUser(result.user);
        loadAllData();
      })
      .catch(() => {
        logout();
      });
  }, [token]);

  const filteredCenters = useMemo(
    () =>
      centers.filter((center) => {
        const query = search.trim().toLowerCase();
        const matchesQuery = !query || [center.name, center.code, center.sector_name, center.notes]
          .some((value) => String(value || '').toLowerCase().includes(query));
        const matchesSector = selectedSectorId === 'all' || Number(center.sector_id) === Number(selectedSectorId);
        return matchesQuery && matchesSector;
      }),
    [centers, search, selectedSectorId],
  );

  const filteredPeople = useMemo(
    () =>
      people.filter((person) => {
        const query = search.trim().toLowerCase();
        if (!query) return true;
        return [person.name, person.code, person.center_name, person.notes].some((value) => String(value || '').toLowerCase().includes(query));
      }),
    [people, search],
  );

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const query = search.trim().toLowerCase();
        if (!query) return true;
        return [item.name, item.code, item.category, item.notes].some((value) => String(value || '').toLowerCase().includes(query));
      }),
    [items, search],
  );

  const filteredInventory = useMemo(
    () =>
      inventory.filter((row) => {
        const query = search.trim().toLowerCase();
        if (!query) return true;
        return [row.item_name, row.item_code, row.item_unit].some((value) => String(value || '').toLowerCase().includes(query));
      }),
    [inventory, search],
  );

  const filteredReportRows = useMemo(() => {
    const rows = reports.needsReport || [];
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!query) return true;
      return [row.sector_name, row.center_name, row.item_name, row.item_unit].some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [reports, search]);

  const handleLogin = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      const result = await apiRequest('/auth/login', 'POST', loginForm);
      localStorage.setItem('token', result.token);
      setToken(result.token);
      setUser(result.user);
      showToast('تم تسجيل الدخول بنجاح');
    } catch (error) {
      showToast(error.message || 'فشل تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  const openCenterModal = (center = null, sectorId = '') => {
    setEditingCenterId(center ? center.id : null);
    setCenterForm(center
      ? { ...center, sector_id: center.sector_id ?? '', people_count: center.people_count ?? '' }
      : { ...initialCenterForm, sector_id: sectorId || sectors[0]?.id || '' });
    setCenterModalOpen(true);
  };

  const openSectorModal = (sector = null) => {
    setEditingSectorId(sector ? sector.id : null);
    setSectorForm(sector ? { ...sector } : initialSectorForm);
    setSectorModalOpen(true);
  };

  const saveSector = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      if (editingSectorId) {
        await apiRequest(`/sectors/${editingSectorId}`, 'PUT', sectorForm);
      } else {
        await apiRequest('/sectors', 'POST', sectorForm);
      }
      setSectorModalOpen(false);
      setSectorForm(initialSectorForm);
      setEditingSectorId(null);
      await loadAllData();
      showToast('تم حفظ القطاع بنجاح');
    } catch (error) {
      showToast(error.message || 'لم يتم حفظ القطاع');
    } finally {
      setLoading(false);
    }
  };

  const deleteSector = async (id) => {
    if (!window.confirm('هل أنت متأكد من حذف القطاع؟')) return;
    try {
      await apiRequest(`/sectors/${id}`, 'DELETE');
      await loadAllData();
      showToast('تم حذف القطاع');
    } catch (error) {
      showToast(error.message || 'فشل حذف القطاع');
    }
  };

  const saveCenter = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      if (editingCenterId) {
        await apiRequest(`/centers/${editingCenterId}`, 'PUT', { ...centerForm, people_count: Number(centerForm.people_count) || 0 });
      } else {
        await apiRequest('/centers', 'POST', { ...centerForm, people_count: Number(centerForm.people_count) || 0 });
      }
      setCenterModalOpen(false);
      setCenterForm(initialCenterForm);
      setEditingCenterId(null);
      await loadAllData();
      showToast('تم حفظ البيانات بنجاح');
    } catch (error) {
      showToast(error.message || 'لم يتم حفظ المركز');
    } finally {
      setLoading(false);
    }
  };

  const deleteCenter = async (id) => {
    if (!window.confirm('هل أنت متأكد من حذف المركز؟')) return;
    try {
      await apiRequest(`/centers/${id}`, 'DELETE');
      await loadAllData();
      showToast('تم حذف المركز');
    } catch (error) {
      showToast(error.message || 'فشل حذف المركز');
    }
  };

  const openPersonModal = (person = null) => {
    setEditingPersonId(person ? person.id : null);
    setPersonForm(person ? { ...person, center_id: person.center_id ?? '' } : { ...initialPersonForm, center_id: centers[0]?.id ?? '' });
    setPersonModalOpen(true);
  };

  const savePerson = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      const payload = {
        ...personForm,
        center_id: Number(personForm.center_id),
      };

      if (editingPersonId) {
        await apiRequest(`/people/${editingPersonId}`, 'PUT', payload);
      } else {
        await apiRequest('/people', 'POST', payload);
      }
      setPersonModalOpen(false);
      setPersonForm(initialPersonForm);
      setEditingPersonId(null);
      await loadAllData();
      showToast('تم حفظ الشخص بنجاح');
    } catch (error) {
      showToast(error.message || 'فشل حفظ الشخص');
    } finally {
      setLoading(false);
    }
  };

  const deletePerson = async (id) => {
    if (!window.confirm('هل أنت متأكد من حذف الشخص؟')) return;
    try {
      await apiRequest(`/people/${id}`, 'DELETE');
      await loadAllData();
      showToast('تم حذف الشخص');
    } catch (error) {
      showToast(error.message || 'فشل حذف الشخص');
    }
  };

  const openItemModal = (item = null) => {
    setEditingItemId(item ? item.id : null);
    setItemForm(item ? { ...item, quantity_per_person: item.quantity_per_person ?? '', min_stock: item.min_stock ?? '' } : initialItemForm);
    setItemModalOpen(true);
  };

  const saveItem = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      const payload = {
        ...itemForm,
        quantity_per_person: Number(itemForm.quantity_per_person) || 0,
        min_stock: Number(itemForm.min_stock) || 0,
      };

      if (editingItemId) {
        await apiRequest(`/items/${editingItemId}`, 'PUT', payload);
      } else {
        await apiRequest('/items', 'POST', payload);
      }
      setItemModalOpen(false);
      setItemForm(initialItemForm);
      setEditingItemId(null);
      await loadAllData();
      showToast('تم حفظ الصنف بنجاح');
    } catch (error) {
      showToast(error.message || 'فشل حفظ الصنف');
    } finally {
      setLoading(false);
    }
  };

  const deleteItem = async (id) => {
    if (!window.confirm('هل أنت متأكد من حذف الصنف؟')) return;
    try {
      await apiRequest(`/items/${id}`, 'DELETE');
      await loadAllData();
      showToast('تم حذف الصنف');
    } catch (error) {
      showToast(error.message || 'فشل حذف الصنف');
    }
  };

  const saveTransaction = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      await apiRequest('/inventory/transactions', 'POST', {
        ...transactionForm,
        quantity: Number(transactionForm.quantity) || 0,
        item_id: Number(transactionForm.item_id),
        center_id: transactionForm.center_id ? Number(transactionForm.center_id) : null,
      });
      setTransactionForm(initialTransactionForm);
      await loadAllData();
      showToast('تم تحديث المخزون');
    } catch (error) {
      showToast(error.message || 'فشل تحديث المخزون');
    } finally {
      setLoading(false);
    }
  };

  const saveDistribution = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      await apiRequest('/distributions', 'POST', {
        ...distributionForm,
        center_id: Number(distributionForm.center_id),
        item_id: Number(distributionForm.item_id),
        quantity: Number(distributionForm.quantity) || 0,
      });
      setDistributionForm(initialDistributionForm);
      await loadAllData();
      showToast('تم تسجيل التوزيع');
    } catch (error) {
      showToast(error.message || 'فشل تسجيل التوزيع');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      const updated = await apiRequest('/settings', 'PUT', {
        ...settingsForm,
        alert_threshold: Number(settingsForm.alert_threshold) || 0,
      });
      setSettings(updated);
      showToast('تم حفظ الإعدادات');
    } catch (error) {
      showToast(error.message || 'فشل حفظ الإعدادات');
    } finally {
      setLoading(false);
    }
  };

  const reportRows = filteredReportRows.map((row) => ({
    'القطاع': row.sector_name,
    'المركز': row.center_name,
    'الصنف': row.item_name,
    'الوحدة': row.item_unit,
    'عدد الأشخاص': row.people_count,
    'الحصة لكل شخص': row.per_person,
    'الإجمالي': row.total_quantity,
  }));

  const inventoryExportRows = filteredInventory.map((row) => ({
    'الصنف': row.item_name,
    'الكود': row.item_code,
    'المتاح': row.current_quantity,
    'الوحدة': row.item_unit,
    'الحد الأدنى': row.min_stock,
    'المطلوب': row.required_quantity || 0,
  }));

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return (
          <>
            <div className="page-header">
              <div>
                <p className="eyebrow">لوحة التحكم</p>
                <h2>ملخص النظام</h2>
              </div>
            </div>

            <div className="metrics-grid">
              <MetricCard label="إجمالي المراكز" value={dashboard.summary?.totalCenters ?? 0} tone="blue" />
              <MetricCard label="إجمالي الأشخاص" value={formatNumber(dashboard.summary?.totalPeople ?? 0)} tone="green" />
              <MetricCard label="إجمالي الأصناف" value={dashboard.summary?.totalItems ?? 0} tone="amber" />
              <MetricCard label="إجمالي الكميات" value={formatNumber(dashboard.summary?.totalRequiredQuantity ?? 0)} tone="purple" />
            </div>

            <div className="panel-grid two-columns">
              <div className="card">
                <h3>توزيع الأشخاص على المراكز</h3>
                <div className="chart-stack">
                  {(dashboard.centerBreakdown || []).map((center) => (
                    <div className="bar-row" key={center.id}>
                      <div className="bar-meta">
                        <span>{center.sector_name ? `${center.sector_name} — ${center.name}` : center.name}</span>
                        <strong>{formatNumber(center.people_count)}</strong>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${Math.max(center.percentage || 0, 4)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <h3>احتياجات الأصناف</h3>
                <div className="chart-stack compact">
                  {(dashboard.needsByItem || []).map((row) => (
                    <div className="bar-row" key={row.id}>
                      <div className="bar-meta">
                        <span>{row.name}</span>
                        <strong>{formatNumber(row.required_quantity)}</strong>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill purple" style={{ width: `${Math.min((row.required_quantity / Math.max(dashboard.summary?.totalRequiredQuantity || 1, 1)) * 100, 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="panel-grid two-columns">
              <div className="card">
                <h3>آخر العمليات</h3>
                <ul className="activity-list">
                  {(dashboard.recentActivity || []).map((item) => (
                    <li key={item.id}>
                      <span>{item.action}</span>
                      <small>{item.user_name || 'النظام'} • {formatDate(item.created_at)}</small>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="card">
                <h3>تنبيهات العجز</h3>
                <ul className="alert-list">
                  {(dashboard.shortages || []).slice(0, 5).map((item) => (
                    <li key={item.id}>
                      <strong>{item.name}</strong>
                      <span>المتاح: {formatNumber(item.stock)} — المطلوب: {formatNumber(item.required_quantity)}</span>
                    </li>
                  ))}
                  {!(dashboard.shortages || []).length && <li className="empty-item">لا توجد تنبيهات حالياً</li>}
                </ul>
              </div>
            </div>
          </>
        );
      case 'centers':
        return (
          <>
            <div className="page-header">
              <div>
                <p className="eyebrow">إدارة القطاعات والمراكز</p>
                <h2>القطاعات والمراكز</h2>
              </div>
              <div className="button-group">
                <button className="ghost-btn" onClick={() => openSectorModal()}>+ إضافة قطاع</button>
                <button className="primary-btn" onClick={() => openCenterModal()}>+ إضافة مركز</button>
              </div>
            </div>
            <div className="toolbar">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث عن مركز..." />
              <select value={selectedSectorId} onChange={(e) => setSelectedSectorId(e.target.value)}>
                <option value="all">كل القطاعات</option>
                {sectors.map((sector) => (
                  <option key={sector.id} value={sector.id}>{sector.name}</option>
                ))}
              </select>
            </div>
            <div className="sector-groups">
              {sectors
                .filter((sector) => selectedSectorId === 'all' || Number(sector.id) === Number(selectedSectorId))
                .filter((sector) => !search.trim() || filteredCenters.some((center) => Number(center.sector_id) === Number(sector.id)))
                .map((sector) => {
                  const sectorCenters = filteredCenters.filter((center) => Number(center.sector_id) === Number(sector.id));
                  return (
                    <section className="sector-group" key={sector.id}>
                      <div className="sector-group-header">
                        <div>
                          <h3>{sector.name}</h3>
                          <p>{sector.code} · {formatNumber(sectorCenters.length)} مراكز</p>
                        </div>
                        <div className="button-group">
                          <button className="primary-btn" onClick={() => openCenterModal(null, sector.id)}>+ إضافة مركز للقطاع</button>
                          <button className="ghost-btn" onClick={() => openSectorModal(sector)}>تعديل القطاع</button>
                          <button
                            className="danger-btn"
                            disabled={Number(sector.centers_count) > 0}
                            title={Number(sector.centers_count) > 0 ? 'انقل المراكز قبل حذف القطاع' : 'حذف القطاع'}
                            onClick={() => deleteSector(sector.id)}
                          >
                            حذف القطاع
                          </button>
                        </div>
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>اسم المركز</th>
                              <th>الكود</th>
                              <th>عدد الأشخاص</th>
                              <th>الحالة</th>
                              <th>ملاحظات</th>
                              <th>إجراءات</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sectorCenters.map((center) => (
                              <tr key={center.id}>
                                <td>{center.name}</td>
                                <td>{center.code}</td>
                                <td>{formatNumber(center.people_count)}</td>
                                <td><span className={`status-tag ${center.status === 'active' ? 'success' : 'muted'}`}>{center.status === 'active' ? 'نشط' : 'غير نشط'}</span></td>
                                <td>{center.notes || '—'}</td>
                                <td className="row-actions">
                                  <button className="ghost-btn" onClick={() => openCenterModal(center)}>تعديل</button>
                                  <button className="danger-btn" onClick={() => deleteCenter(center.id)}>حذف</button>
                                </td>
                              </tr>
                            ))}
                            {!sectorCenters.length && (
                              <tr><td colSpan="6">لا توجد مراكز بهذا القطاع بعد</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  );
                })}
              {!filteredCenters.length && search.trim() && <div className="empty-state">لا توجد مراكز مطابقة للبحث</div>}
            </div>
          </>
        );
      case 'people':
        return (
          <>
            <div className="page-header">
              <div>
                <p className="eyebrow">إجمالي عدد السكان</p>
                <h2>الأعداد الإجمالية للمراكز</h2>
              </div>
              <button className="primary-btn" onClick={() => setCurrentPage('centers')}>العودة للمراكز</button>
            </div>
            <div className="card info-card">
              <p>يتم إدخال العدد الإجمالي للأشخاص مباشرة في بيانات كل مركز، ولا يلزم تسجيل أسماء الفردية.</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>القطاع</th>
                    <th>المركز</th>
                    <th>إجمالي عدد الأشخاص</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {centers.map((center) => (
                    <tr key={center.id}>
                      <td>{center.sector_name || '—'}</td>
                      <td>{center.name}</td>
                      <td>{formatNumber(center.people_count)}</td>
                      <td><span className={`status-tag ${center.status === 'active' ? 'success' : 'muted'}`}>{center.status === 'active' ? 'نشط' : 'غير نشط'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        );
      case 'items':
        return (
          <>
            <div className="page-header">
              <div>
                <p className="eyebrow">إدارة الأصناف</p>
                <h2>الأصناف</h2>
              </div>
              <button className="primary-btn" onClick={() => openItemModal()}>+ إضافة صنف</button>
            </div>
            <div className="toolbar">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث عن صنف..." />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>اسم الصنف</th>
                    <th>الكود</th>
                    <th>التصنيف</th>
                    <th>الوحدة</th>
                    <th>حصة الشخص</th>
                    <th>الحد الأدنى</th>
                    <th>الحالة</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{item.code}</td>
                      <td>{item.category || 'عام'}</td>
                      <td>{item.unit || 'كيلوجرام'}</td>
                      <td>{formatNumber(item.quantity_per_person)}</td>
                      <td>{formatNumber(item.min_stock)}</td>
                      <td><span className={`status-tag ${item.status === 'active' ? 'success' : 'muted'}`}>{item.status === 'active' ? 'نشط' : 'غير نشط'}</span></td>
                      <td className="row-actions">
                        <button className="ghost-btn" onClick={() => openItemModal(item)}>تعديل</button>
                        <button className="danger-btn" onClick={() => deleteItem(item.id)}>حذف</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredItems.length && <div className="empty-state">لا توجد أصناف مطابقة للبحث</div>}
            </div>
          </>
        );
      case 'needs':
        return (
          <>
            <div className="page-header">
              <div>
                <p className="eyebrow">احتياجات جميع المراكز</p>
                <h2>حساب الاحتياجات</h2>
              </div>
            </div>
            <div className="toolbar">
              <select value={reportCenterId} onChange={(e) => setReportCenterId(e.target.value)}>
                <option value="all">كل المراكز</option>
                {centers.map((center) => (
                  <option key={center.id} value={center.id}>{center.sector_name ? `${center.sector_name} — ${center.name}` : center.name}</option>
                ))}
              </select>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>القطاع</th>
                    <th>المركز</th>
                    <th>الصنف</th>
                    <th>عدد الأشخاص</th>
                    <th>الحصة</th>
                    <th>الإجمالي</th>
                    <th>الوحدة</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReportRows.map((row, index) => (
                    <tr key={`${row.center_name}-${row.item_name}-${index}`}>
                      <td>{row.sector_name || '—'}</td>
                      <td>{row.center_name}</td>
                      <td>{row.item_name}</td>
                      <td>{formatNumber(row.people_count)}</td>
                      <td>{formatNumber(row.per_person)}</td>
                      <td>{formatNumber(row.total_quantity)}</td>
                      <td>{row.item_unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredReportRows.length && <div className="empty-state">لا توجد احتياجات لعرضها</div>}
            </div>
          </>
        );
      case 'inventory':
        return (
          <>
            <div className="page-header">
              <div>
                <p className="eyebrow">المخزون</p>
                <h2>الحركات والمخزون</h2>
              </div>
            </div>

            <div className="module-grid">
              <div className="card form-card">
                <h3>إضافة حركة مخزنية</h3>
                <form onSubmit={saveTransaction} className="stack-form">
                  <select value={transactionForm.item_id} onChange={(e) => setTransactionForm({ ...transactionForm, item_id: e.target.value })}>
                    <option value="">اختر الصنف</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                  <select value={transactionForm.type} onChange={(e) => setTransactionForm({ ...transactionForm, type: e.target.value })}>
                    <option value="incoming">وارد</option>
                    <option value="outgoing">منصرف</option>
                  </select>
                  <input type="number" value={transactionForm.quantity} onChange={(e) => setTransactionForm({ ...transactionForm, quantity: e.target.value })} placeholder="الكمية" />
                  <input value={transactionForm.unit} onChange={(e) => setTransactionForm({ ...transactionForm, unit: e.target.value })} placeholder="الوحدة" />
                  <input type="date" value={transactionForm.date} onChange={(e) => setTransactionForm({ ...transactionForm, date: e.target.value })} />
                  <input value={transactionForm.source} onChange={(e) => setTransactionForm({ ...transactionForm, source: e.target.value })} placeholder="المورد أو المصدر" />
                  <input value={transactionForm.invoice_no} onChange={(e) => setTransactionForm({ ...transactionForm, invoice_no: e.target.value })} placeholder="رقم الفاتورة" />
                  <textarea value={transactionForm.notes} onChange={(e) => setTransactionForm({ ...transactionForm, notes: e.target.value })} placeholder="ملاحظات" rows="3" />
                  <button type="submit" className="primary-btn">حفظ الحركة</button>
                </form>
              </div>

              <div className="card">
                <h3>مستودع الأصناف</h3>
                <div className="inventory-list">
                  {filteredInventory.map((row) => (
                    <div key={row.item_id} className="inventory-item">
                      <div className="inventory-topline">
                        <strong>{row.item_name}</strong>
                        <span className={Number(row.current_quantity) < Number(row.min_stock || 0) ? 'danger-text' : 'success-text'}>
                          {Number(row.current_quantity) < Number(row.min_stock || 0) ? '⚠️ غير كافٍ' : '✅ كافي'}
                        </span>
                      </div>
                      <div className="inventory-meta">
                        <span>المتاح: {formatNumber(row.current_quantity)}</span>
                        <span>الحد الأدنى: {formatNumber(row.min_stock)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        );
      case 'distributions':
        return (
          <>
            <div className="page-header">
              <div>
                <p className="eyebrow">التوزيع</p>
                <h2>مخصصات التوزيع</h2>
              </div>
            </div>
            <div className="module-grid">
              <div className="card form-card">
                <h3>إنشاء توزيع جديد</h3>
                <form onSubmit={saveDistribution} className="stack-form">
                  <select value={distributionForm.center_id} onChange={(e) => setDistributionForm({ ...distributionForm, center_id: e.target.value })}>
                    <option value="">اختر المركز</option>
                    {centers.map((center) => (
                      <option key={center.id} value={center.id}>{center.sector_name ? `${center.sector_name} — ${center.name}` : center.name}</option>
                    ))}
                  </select>
                  <select value={distributionForm.item_id} onChange={(e) => setDistributionForm({ ...distributionForm, item_id: e.target.value })}>
                    <option value="">اختر الصنف</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                  <input type="number" value={distributionForm.quantity} onChange={(e) => setDistributionForm({ ...distributionForm, quantity: e.target.value })} placeholder="الكمية" />
                  <input type="date" value={distributionForm.date} onChange={(e) => setDistributionForm({ ...distributionForm, date: e.target.value })} />
                  <input value={distributionForm.responsible} onChange={(e) => setDistributionForm({ ...distributionForm, responsible: e.target.value })} placeholder="اسم المسؤول" />
                  <textarea value={distributionForm.notes} onChange={(e) => setDistributionForm({ ...distributionForm, notes: e.target.value })} placeholder="ملاحظات" rows="3" />
                  <button type="submit" className="primary-btn">حفظ التوزيع</button>
                </form>
              </div>

              <div className="card">
                <h3>سجل التوزيعات</h3>
                <ul className="activity-list compact-list">
                  {distributions.map((row) => (
                    <li key={row.id}>
                      <span>{row.sector_name ? `${row.sector_name} — ${row.center_name}` : row.center_name} → {row.item_name}</span>
                      <small>{formatNumber(row.quantity)} • {formatDate(row.date)}</small>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        );
      case 'reports':
        return (
          <>
            <div className="page-header">
              <div>
                <p className="eyebrow">التقارير</p>
                <h2>تقارير الاحتياجات والمخزون</h2>
              </div>
              <div className="button-group">
                <button className="ghost-btn" onClick={() => exportCsv(reportRows, 'need_report')}>CSV</button>
                <button className="ghost-btn" onClick={() => exportExcel(reportRows, 'need_report_excel')}>Excel</button>
                <button className="primary-btn" onClick={() => window.print()}>طباعة</button>
              </div>
            </div>
            <div className="toolbar report-toolbar">
              <select value={reportCenterId} onChange={(e) => setReportCenterId(e.target.value)}>
                <option value="all">كل المراكز</option>
                {centers.map((center) => (
                  <option key={center.id} value={center.id}>{center.sector_name ? `${center.sector_name} — ${center.name}` : center.name}</option>
                ))}
              </select>
              <select value={reportItemId} onChange={(e) => setReportItemId(e.target.value)}>
                <option value="all">كل الأصناف</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <button className="ghost-btn" onClick={() => {
                setReportCenterId('all');
                setReportItemId('all');
              }}>إعادة تعيين</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>المركز</th>
                    <th>الصنف</th>
                    <th>العدد</th>
                    <th>الحصة</th>
                    <th>الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((row, index) => (
                    <tr key={`report-${index}`}>
                      <td>{row['المركز']}</td>
                      <td>{row['الصنف']}</td>
                      <td>{row['عدد الأشخاص']}</td>
                      <td>{row['الحصة لكل شخص']}</td>
                      <td>{row['الإجمالي']}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        );
      case 'activity':
        return (
          <>
            <div className="page-header">
              <div>
                <p className="eyebrow">سجل العمليات</p>
                <h2>آخر الأنشطة</h2>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الإجراء</th>
                    <th>التفاصيل</th>
                    <th>المستخدم</th>
                    <th>التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {(activity || []).map((row) => (
                    <tr key={row.id}>
                      <td>{row.action}</td>
                      <td>{row.details}</td>
                      <td>{row.user_name || 'النظام'}</td>
                      <td>{formatDate(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        );
      case 'settings':
        return (
          <>
            <div className="page-header">
              <div>
                <p className="eyebrow">الإعدادات</p>
                <h2>إعدادات النظام</h2>
              </div>
            </div>
            <div className="module-grid">
              <div className="card form-card wide-card">
                <form onSubmit={saveSettings} className="stack-form">
                  <input value={settingsForm.company_name} onChange={(e) => setSettingsForm({ ...settingsForm, company_name: e.target.value })} placeholder="اسم المؤسسة" />
                  <input value={settingsForm.currency} onChange={(e) => setSettingsForm({ ...settingsForm, currency: e.target.value })} placeholder="العملة" />
                  <input type="number" value={settingsForm.alert_threshold} onChange={(e) => setSettingsForm({ ...settingsForm, alert_threshold: e.target.value })} placeholder="حد التنبيهات" />
                  <textarea value={settingsForm.report_footer} rows="4" onChange={(e) => setSettingsForm({ ...settingsForm, report_footer: e.target.value })} placeholder="تذييل التقارير" />
                  <button type="submit" className="primary-btn">حفظ الإعدادات</button>
                </form>
              </div>
            </div>
          </>
        );
      default:
        return null;
    }
  };

  if (!user) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-header">
            <div className="brand-badge">ن</div>
            <div>
              <p className="eyebrow">نظام إدارة الاحتياجات</p>
              <h1>تسجيل الدخول</h1>
            </div>
          </div>

          <form onSubmit={handleLogin} className="stack-form">
            <input
              value={loginForm.username}
              onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
              placeholder="اسم المستخدم"
            />
            <input
              type="password"
              value={loginForm.password}
              onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              placeholder="كلمة المرور"
            />
            <button type="submit" className="primary-btn" disabled={loading}>تسجيل الدخول</button>
          </form>
          <p className="login-note">الحساب الأول يُنشأ باستخدام ADMIN_PASSWORD عند تهيئة قاعدة بيانات جديدة.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-badge">ن</div>
          <div>
            <strong>{settings.company_name || 'نظام إدارة الاحتياجات'}</strong>
            <small>{user.role}</small>
          </div>
        </div>

        <nav className="menu">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
              onClick={() => setCurrentPage(item.id)}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <button type="button" className="logout-btn" onClick={logout}>تسجيل الخروج</button>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">مرحباً</p>
            <h1>{user.name}</h1>
          </div>
          <div className="status-pill">{settings.currency || 'ريال'}</div>
        </header>

        {toast && <div className="toast">{toast}</div>}
        {loading && <div className="loading-bar" />}

        <div className="content">
          {renderPage()}
        </div>
      </main>

      {sectorModalOpen && (
        <div className="modal-backdrop" onClick={() => setSectorModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{editingSectorId ? 'تعديل القطاع' : 'إضافة قطاع جديد'}</h3>
            <form onSubmit={saveSector} className="stack-form">
              <input value={sectorForm.name} onChange={(e) => setSectorForm({ ...sectorForm, name: e.target.value })} placeholder="اسم القطاع" required />
              <input value={sectorForm.code} onChange={(e) => setSectorForm({ ...sectorForm, code: e.target.value })} placeholder="كود القطاع" required />
              <textarea value={sectorForm.notes || ''} onChange={(e) => setSectorForm({ ...sectorForm, notes: e.target.value })} rows="3" placeholder="ملاحظات" />
              <div className="button-group">
                <button type="button" className="ghost-btn" onClick={() => setSectorModalOpen(false)}>إلغاء</button>
                <button type="submit" className="primary-btn">حفظ</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {centerModalOpen && (
        <div className="modal-backdrop" onClick={() => setCenterModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{editingCenterId ? 'تعديل المركز' : 'إضافة مركز جديد'}</h3>
            <form onSubmit={saveCenter} className="stack-form">
              <input value={centerForm.name} onChange={(e) => setCenterForm({ ...centerForm, name: e.target.value })} placeholder="اسم المركز" />
              <input value={centerForm.code} onChange={(e) => setCenterForm({ ...centerForm, code: e.target.value })} placeholder="كود المركز" />
              <select value={centerForm.sector_id} onChange={(e) => setCenterForm({ ...centerForm, sector_id: e.target.value })} required>
                <option value="">اختر القطاع</option>
                {sectors.map((sector) => (
                  <option key={sector.id} value={sector.id}>{sector.name}</option>
                ))}
              </select>
              <input type="number" value={centerForm.people_count} onChange={(e) => setCenterForm({ ...centerForm, people_count: e.target.value })} placeholder="إجمالي عدد الأشخاص" />
              <select value={centerForm.status} onChange={(e) => setCenterForm({ ...centerForm, status: e.target.value })}>
                <option value="active">نشط</option>
                <option value="inactive">غير نشط</option>
              </select>
              <textarea value={centerForm.notes} onChange={(e) => setCenterForm({ ...centerForm, notes: e.target.value })} rows="3" placeholder="ملاحظات" />
              <div className="button-group">
                <button type="button" className="ghost-btn" onClick={() => setCenterModalOpen(false)}>إلغاء</button>
                <button type="submit" className="primary-btn">حفظ</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {personModalOpen && (
        <div className="modal-backdrop" onClick={() => setPersonModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{editingPersonId ? 'تعديل الشخص' : 'إضافة شخص جديد'}</h3>
            <form onSubmit={savePerson} className="stack-form">
              <input value={personForm.name} onChange={(e) => setPersonForm({ ...personForm, name: e.target.value })} placeholder="اسم الشخص" />
              <input value={personForm.code} onChange={(e) => setPersonForm({ ...personForm, code: e.target.value })} placeholder="كود الشخص" />
              <select value={personForm.center_id} onChange={(e) => setPersonForm({ ...personForm, center_id: e.target.value })}>
                <option value="">اختر المركز</option>
                {centers.map((center) => (
                  <option key={center.id} value={center.id}>{center.sector_name ? `${center.sector_name} — ${center.name}` : center.name}</option>
                ))}
              </select>
              <select value={personForm.status} onChange={(e) => setPersonForm({ ...personForm, status: e.target.value })}>
                <option value="active">نشط</option>
                <option value="inactive">غير نشط</option>
              </select>
              <textarea value={personForm.notes} onChange={(e) => setPersonForm({ ...personForm, notes: e.target.value })} rows="3" placeholder="ملاحظات" />
              <div className="button-group">
                <button type="button" className="ghost-btn" onClick={() => setPersonModalOpen(false)}>إلغاء</button>
                <button type="submit" className="primary-btn">حفظ</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {itemModalOpen && (
        <div className="modal-backdrop" onClick={() => setItemModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{editingItemId ? 'تعديل الصنف' : 'إضافة صنف جديد'}</h3>
            <form onSubmit={saveItem} className="stack-form">
              <input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} placeholder="اسم الصنف" />
              <input value={itemForm.code} onChange={(e) => setItemForm({ ...itemForm, code: e.target.value })} placeholder="كود الصنف" />
              <input value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} placeholder="التصنيف" />
              <select value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}>
                <option value="كيلوجرام">كيلوجرام</option>
                <option value="جرام">جرام</option>
                <option value="لتر">لتر</option>
                <option value="مل">مل</option>
                <option value="قطعة">قطعة</option>
                <option value="كرتونة">كرتونة</option>
                <option value="عبوة">عبوة</option>
                <option value="صندوق">صندوق</option>
              </select>
              <input type="number" value={itemForm.quantity_per_person} onChange={(e) => setItemForm({ ...itemForm, quantity_per_person: e.target.value })} placeholder="كمية الشخص الواحد" />
              <input type="number" value={itemForm.min_stock} onChange={(e) => setItemForm({ ...itemForm, min_stock: e.target.value })} placeholder="الحد الأدنى" />
              <select value={itemForm.status} onChange={(e) => setItemForm({ ...itemForm, status: e.target.value })}>
                <option value="active">نشط</option>
                <option value="inactive">غير نشط</option>
              </select>
              <textarea value={itemForm.notes} onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })} rows="3" placeholder="ملاحظات" />
              <div className="button-group">
                <button type="button" className="ghost-btn" onClick={() => setItemModalOpen(false)}>إلغاء</button>
                <button type="submit" className="primary-btn">حفظ</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, tone }) {
  return (
    <div className={`stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default App;
