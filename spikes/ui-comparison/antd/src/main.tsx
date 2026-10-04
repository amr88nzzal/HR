import { Badge, Button, ConfigProvider, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import arEG from 'antd/locale/ar_EG';
import dayjs from 'dayjs';
import 'dayjs/locale/ar';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { departments, employees } from '../../data';

dayjs.locale('ar');

const App = () => {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<React.Key[]>([2]);
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={2}>الموظفون</Typography.Title>
        <Button type="primary" onClick={() => setOpen(true)}>إضافة موظف</Button>
      </Space>
      <Tabs defaultActiveKey="list" items={[{ key: 'list', label: 'القائمة' }, { key: 'org', label: 'الهيكل' }, { key: 'docs', label: 'الأرشيف' }]} />
      <Space style={{ marginBottom: 12, width: '100%' }} wrap>
        <Input placeholder="الاسم أو الرقم الوظيفي" style={{ width: 260 }} />
        <Select placeholder="القسم" allowClear style={{ width: 200 }} options={departments.map((d) => ({ value: d, label: d }))} />
        <DatePicker defaultValue={dayjs('2019-03-01')} format="YYYY-MM-DD" />
      </Space>
      <Table
        rowKey="id"
        dataSource={employees}
        pagination={false}
        rowSelection={{ selectedRowKeys: sel, onChange: setSel }}
        columns={[
          { title: 'الرقم', dataIndex: 'no', render: (v) => <span dir="ltr">{v}</span>, sorter: true },
          { title: 'الاسم', dataIndex: 'name' },
          { title: 'القسم', dataIndex: 'dept' },
          { title: 'المسمى', dataIndex: 'title' },
          { title: 'التعيين', dataIndex: 'hired', render: (v) => <span dir="ltr">{v}</span> },
          { title: 'الراتب', dataIndex: 'salary', align: 'end', render: (v) => <span dir="ltr">{v}</span> },
          { title: 'الحالة', dataIndex: 'status', render: (v) => <Tag color={v === 'نشط' ? 'green' : v === 'إجازة' ? 'gold' : 'default'}>{v}</Tag> },
        ]}
      />
      <Modal open={open} onCancel={() => setOpen(false)} title="موظف جديد" width={640} okText="حفظ" cancelText="إلغاء">
        <Form layout="vertical">
          <Space style={{ width: '100%' }} align="start">
            <Form.Item label="الاسم الكامل" required><Input /></Form.Item>
            <Form.Item label="الرقم الوطني" required validateStatus="error" help="الرقم الوطني مطلوب"><Input /></Form.Item>
          </Space>
          <Space style={{ width: '100%' }} align="start">
            <Form.Item label="القسم"><Select showSearch style={{ width: 200 }} options={departments.map((d) => ({ value: d, label: d }))} /></Form.Item>
            <Form.Item label="تاريخ التعيين"><DatePicker format="YYYY-MM-DD" /></Form.Item>
          </Space>
          <Form.Item label="الراتب الأساسي"><InputNumber precision={3} style={{ width: 200 }} /></Form.Item>
          <Form.Item label="ملاحظات"><Input.TextArea /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider direction="rtl" locale={arEG} theme={{ token: { fontFamily: 'Amiri, "Noto Naskh Arabic", system-ui, sans-serif' } }}>
      <App />
    </ConfigProvider>
  </StrictMode>,
);
