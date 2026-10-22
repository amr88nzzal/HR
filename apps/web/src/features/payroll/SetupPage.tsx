import { Stack, Tabs, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { BasesPanel } from './BasesPanel';
import { ComponentsPanel } from './ComponentsPanel';
import { GlSettingsPanel } from './GlSettingsPanel';
import { LoanTypesPanel } from './LoanTypesPanel';
import { RatesPanel } from './RatesPanel';
import { SimpleListPanel } from './GroupsPanel';
import { StructuresPanel } from './StructuresPanel';

export const SetupPage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const tabs = [
    { value: 'components', perm: 'payroll.component.read', body: <ComponentsPanel /> },
    { value: 'bases', perm: 'payroll.base.read', body: <BasesPanel /> },
    { value: 'rateTables', perm: 'payroll.rate_table.read', body: <RatesPanel /> },
    { value: 'structures', perm: 'payroll.structure.read', body: <StructuresPanel /> },
    {
      value: 'groups',
      perm: 'payroll.group.read',
      body: <SimpleListPanel base="groups" perm="payroll.group" kind="group" />,
    },
    {
      value: 'reasons',
      perm: 'payroll.override_reason.read',
      body: (
        <SimpleListPanel base="override-reasons" perm="payroll.override_reason" kind="reason" />
      ),
    },
    { value: 'loanTypes', perm: 'payroll.loan_type.read', body: <LoanTypesPanel /> },
    { value: 'accounting', perm: 'payroll.accounting.read', body: <GlSettingsPanel /> },
  ].filter((x) => can(x.perm));
  return (
    <Stack>
      <Title order={2}>{t('nav.payrollSetup')}</Title>
      <Tabs defaultValue={tabs[0]?.value} keepMounted={false}>
        <Tabs.List>
          {tabs.map((x) => (
            <Tabs.Tab key={x.value} value={x.value}>
              {t(`payroll.tabs.${x.value}`)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {tabs.map((x) => (
          <Tabs.Panel key={x.value} value={x.value} pt="md">
            {x.body}
          </Tabs.Panel>
        ))}
      </Tabs>
    </Stack>
  );
};
