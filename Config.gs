/**
 * Phase 1 configuration. Every server module must refer to sheet names and
 * fields through this object rather than embedding spreadsheet coordinates.
 */
const APP_CONFIG = Object.freeze({
  APP_NAME: 'Garment Production Automation',
  VERSION: '1.0.0',
  SCHEMA_VERSION: '1.0.0',
  ENVIRONMENT_PROPERTY: 'GARMENT_PRODUCTION_ENVIRONMENT',
  SPREADSHEET_ID_PROPERTY: 'GARMENT_PRODUCTION_SPREADSHEET_ID',
  BACKUP_FOLDER_ID_PROPERTY: 'GARMENT_BACKUP_FOLDER_ID',
  BACKUP_RETENTION_COUNT_PROPERTY: 'GARMENT_BACKUP_RETENTION_COUNT',
  RECOVERY_TEST_SPREADSHEET_ID_PROPERTY: 'GARMENT_RECOVERY_TEST_SPREADSHEET_ID',
  BACKUP_FILE_PREFIX: 'Garment Production Automation Backup ',
  BACKUP_FILE_TAG_PREFIX: 'GARMENT_SYSTEM_BACKUP|SOURCE:',
  INITIAL_ADMIN_EMAIL_PROPERTY: 'GARMENT_INITIAL_ADMIN_EMAIL',
  GOOGLE_OAUTH_CLIENT_ID_PROPERTY: 'GARMENT_GOOGLE_OAUTH_CLIENT_ID',
  GOOGLE_OAUTH_CLIENT_SECRET_PROPERTY: 'GARMENT_GOOGLE_OAUTH_CLIENT_SECRET',
  WEB_APP_URL_PROPERTY: 'GARMENT_WEB_APP_URL',
  EXTERNAL_IDENTITY_EMAIL_PROPERTY: 'GARMENT_EXTERNAL_IDENTITY_EMAIL',
  EXTERNAL_IDENTITY_EXPIRY_PROPERTY: 'GARMENT_EXTERNAL_IDENTITY_EXPIRY',
  EXTERNAL_IDENTITY_STATE_PROPERTY: 'GARMENT_EXTERNAL_IDENTITY_OAUTH_STATE',
  EXTERNAL_IDENTITY_STATE_EXPIRY_PROPERTY: 'GARMENT_EXTERNAL_IDENTITY_OAUTH_STATE_EXPIRY',
  OTP_PEPPER_PROPERTY: 'GARMENT_OTP_PEPPER',
  OTP_RECORD_PREFIX: 'GARMENT_OTP_RECORD_',
  OTP_SESSION_PREFIX: 'GARMENT_OTP_SESSION_',
  OTP_EXPIRY_MILLIS: 10 * 60 * 1000,
  OTP_MAX_ATTEMPTS: 5,
  OTP_MIN_REQUEST_INTERVAL_MILLIS: 60 * 1000,
  OTP_MAX_REQUESTS_PER_HOUR: 5,
  OTP_SESSION_EXPIRY_MILLIS: 8 * 60 * 60 * 1000,
  SHEETS: Object.freeze({
    USERS: 'Users',
    DEPARTMENTS: 'Departments',
    PRODUCTS: 'Products',
    CUSTOMERS: 'Customers',
    PRODUCTION_ORDERS: 'ProductionOrders',
    TASKS: 'Tasks',
    TASK_HISTORY: 'TaskHistory',
    WORKFLOW_CONFIG: 'WorkflowConfig',
    NOTIFICATIONS: 'Notifications',
    ALERTS: 'Alerts',
    AUDIT_LOG: 'AuditLog',
    SETTINGS: 'Settings',
    DASHBOARD_DATA: 'DashboardData', REPORT_PRODUCTION: 'ReportProduction', REPORT_TASKS: 'ReportTasks', REPORT_DEPARTMENT: 'ReportDepartmentPerformance', REPORT_CYCLE: 'ReportOrderCycleTime', REPORT_DELIVERY: 'ReportDelivery', REPORT_DAILY: 'ReportDailyProduction'
  }),
  STATUS: Object.freeze({
    PENDING: 'PENDING', READY: 'READY', IN_PROGRESS: 'IN_PROGRESS',
    ON_HOLD: 'ON_HOLD', COMPLETED: 'COMPLETED', OVERDUE: 'OVERDUE',
    CANCELLED: 'CANCELLED', BLOCKED: 'BLOCKED'
  }),
  ROLES: Object.freeze({ ADMIN: 'ADMIN', DEPARTMENT_USER: 'DEPARTMENT_USER' }),
  PRIORITIES: Object.freeze(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']),
  ALERT_LEVELS: Object.freeze(['GREEN', 'YELLOW', 'RED', 'BLOCKED']),
  ID_PREFIXES: Object.freeze({
    USERS: 'USR', DEPARTMENTS: 'DEPT', PRODUCTS: 'PROD', CUSTOMERS: 'CUST',
    ORDERS: 'ORD', TASKS: 'TASK', HISTORY: 'HIST', NOTIFICATIONS: 'NOTIF',
    ALERTS: 'ALERT', AUDIT_LOG: 'LOG'
  }),
  ANNUAL_ID_PREFIXES: Object.freeze(['ORD', 'TASK', 'ALERT', 'NOTIF', 'LOG', 'HIST']),
  DATE_FORMAT: 'yyyy-MM-dd HH:mm:ss'
});

/** @return {Object<string, string[]>} Ordered canonical header definitions. */
function getSheetSchemas_() {
  return {
    [APP_CONFIG.SHEETS.USERS]: ['User ID', 'Email', 'Display Name', 'Role', 'Department ID', 'Department Name', 'Active', 'Created Date', 'Updated Date'],
    [APP_CONFIG.SHEETS.DEPARTMENTS]: ['Department ID', 'Department Name', 'Sequence', 'Active', 'Default Assignee Email', 'Description', 'Created Date', 'Updated Date', 'Default Task Duration Hours'],
    [APP_CONFIG.SHEETS.PRODUCTS]: ['Product ID', 'Product Name', 'Category', 'Garment Type', 'Fabric Type', 'Size', 'Color', 'Unit', 'Standard Production Time Hours', 'Selling Price', 'Cost Price', 'Active', 'Created Date', 'Updated Date'],
    [APP_CONFIG.SHEETS.CUSTOMERS]: ['Customer ID', 'Customer Name', 'Contact Name', 'Email', 'Phone', 'Address', 'Active', 'Created Date', 'Updated Date'],
    [APP_CONFIG.SHEETS.PRODUCTION_ORDERS]: ['Order ID', 'Customer ID', 'Customer Name', 'Product ID', 'Product Name', 'Garment Type', 'Size', 'Color', 'Quantity', 'Unit', 'Order Date', 'Required Delivery Date', 'Priority', 'Created By', 'Created Date', 'Overall Status', 'Remarks', 'Completed Quantity', 'Updated Date'],
    [APP_CONFIG.SHEETS.TASKS]: ['Task ID', 'Order ID', 'Workflow Step', 'Department ID', 'Department Name', 'Task Name', 'Assigned User Email', 'Quantity Planned', 'Quantity Completed', 'Unit', 'Assigned Date', 'Start Date', 'Deadline', 'Completed Date', 'Status', 'Priority', 'Overdue Flag', 'Remaining Time Hours', 'Task Duration Hours', 'Delay Duration Hours', 'Remarks', 'Created Date', 'Updated Date', 'Version', 'Quantity Remaining'],
    [APP_CONFIG.SHEETS.TASK_HISTORY]: ['History ID', 'Task ID', 'Order ID', 'Timestamp', 'Actor Email', 'Actor Role', 'Previous Status', 'New Status', 'Previous Quantity Completed', 'New Quantity Completed', 'Remarks', 'Event Type'],
    [APP_CONFIG.SHEETS.WORKFLOW_CONFIG]: ['Workflow ID', 'Workflow Name', 'Step Number', 'Department ID', 'Department Name', 'Task Name Template', 'Required Completion Percent', 'Active', 'Created Date', 'Updated Date', 'Is Required', 'Default Duration Hours'],
    [APP_CONFIG.SHEETS.NOTIFICATIONS]: ['Notification ID', 'Recipient Email', 'Department ID', 'Order ID', 'Task ID', 'Event Type', 'Channel', 'Subject', 'Message', 'Status', 'Sent Date', 'Created Date', 'Deduplication Key', 'Severity', 'Read At', 'Acknowledged At', 'Acknowledged By', 'Updated Date'],
    [APP_CONFIG.SHEETS.ALERTS]: ['Alert ID', 'Alert Level', 'Alert Type', 'Order ID', 'Task ID', 'Department ID', 'Message', 'Status', 'Raised Date', 'Resolved Date', 'Deduplication Key', 'Created Date', 'Updated Date', 'Department Name', 'Deadline', 'Delay Duration Hours', 'Acknowledged At', 'Acknowledged By'],
    [APP_CONFIG.SHEETS.AUDIT_LOG]: ['Log ID', 'Timestamp', 'User Email', 'Role', 'Action', 'Entity Type', 'Entity ID', 'Old Value JSON', 'New Value JSON', 'Remarks', 'Correlation ID'],
    [APP_CONFIG.SHEETS.SETTINGS]: ['Setting Key', 'Setting Value', 'Value Type', 'Description', 'Updated Date', 'Updated By'],
    [APP_CONFIG.SHEETS.DASHBOARD_DATA]: ['Snapshot ID', 'Snapshot Date', 'Metric Group', 'Metric Name', 'Dimension Type', 'Dimension ID', 'Dimension Name', 'Metric Value', 'Refresh Date']
    ,[APP_CONFIG.SHEETS.REPORT_PRODUCTION]: ['Order ID','Product ID','Customer ID','Current Department ID','Order Quantity','Completed Quantity','Remaining Quantity','Progress Percent','Order Status','Order Date','Required Delivery Date','Completion Date','On Time','Delay Hours','Priority','Product Name','Customer Name']
    ,[APP_CONFIG.SHEETS.REPORT_TASKS]: ['Task ID','Order ID','Department ID','Assigned User Email','Quantity Planned','Quantity Completed','Quantity Remaining','Status','Deadline','Completed Date','Task Duration Hours','Delay Hours']
    ,[APP_CONFIG.SHEETS.REPORT_DEPARTMENT]: ['Department ID','Department Name','Total Tasks','Completed Tasks','Pending Tasks','In Progress Tasks','Overdue Tasks','Blocked Tasks','Planned Quantity','Completed Quantity','On Time Percent','Overdue Percent','Average Duration Hours','Average Delay Hours','Throughput']
    ,[APP_CONFIG.SHEETS.REPORT_CYCLE]: ['Order ID','Department ID','Stage Duration Hours','Total Cycle Hours','Bottleneck']
    ,[APP_CONFIG.SHEETS.REPORT_DELIVERY]: ['Metric','Metric Value','Snapshot Date']
    ,[APP_CONFIG.SHEETS.REPORT_DAILY]: ['Date','Department ID','Orders Active','Tasks Completed','Quantity Planned','Quantity Completed','Overdue Tasks','Blocked Tasks','Average Completion Time Hours']
  };
}
