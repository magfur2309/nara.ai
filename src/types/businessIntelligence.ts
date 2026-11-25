import type React from 'react';

export type BiModuleId =
  | 'accounting'
  | 'sales'
  | 'purchasing'
  | 'inventory'
  | 'production';

export interface BiKpiMenuContext {
  idToken: string;
  onDownloadBridge?: () => void;
}

export interface BiKpiMenuDefinition {
  id: string;
  order: number;
  code?: string;
  moduleId: BiModuleId;
  category: string;
  title: string;
  shortDescription: string;
  chartTypeLabel: string;
  formulaSummary: string;
  sourceTables: string[];
  render: (ctx: BiKpiMenuContext) => React.ReactNode;
}

export interface BiModuleDefinition {
  id: BiModuleId;
  name: string;
  erpCode: string;
  description: string;
  kpiMenus: BiKpiMenuDefinition[];
}
