/** Creates an order and its complete configured workflow. Administrator only. */
function createProductionOrder(input) {
  return withScriptLock_(() => createProductionOrderUnderLock_(input));
}

/**
 * Read-only reconciliation aid for a browser request whose response was
 * ambiguous. It exposes only the latest order ID and structural counts.
 */
function inspectLatestOrderCreationState() {
  requireAdmin_();
  const orders = getSheetData(APP_CONFIG.SHEETS.PRODUCTION_ORDERS)
    .slice().sort((left, right) => String(right['Created Date']).localeCompare(String(left['Created Date'])));
  if (!orders.length) {
    const emptyResult = { orderFound: false, taskCount: 0, taskHistoryCount: 0, createOrderAuditCount: 0 };
    console.log(JSON.stringify(emptyResult, null, 2));
    return emptyResult;
  }
  const order = orders[0];
  const orderId = order['Order ID'];
  const tasks = getTasksForOrder_(orderId);
  const history = getSheetData(APP_CONFIG.SHEETS.TASK_HISTORY).filter(row => String(row['Order ID']) === String(orderId));
  const audits = getSheetData(APP_CONFIG.SHEETS.AUDIT_LOG).filter(row => String(row['Entity ID']) === String(orderId) && row['Action'] === 'CREATE_ORDER');
  const result = {
    orderFound: true, orderId: orderId, orderStatus: order['Overall Status'], taskCount: tasks.length,
    readyTaskCount: tasks.filter(task => task['Status'] === APP_CONFIG.STATUS.READY).length,
    pendingTaskCount: tasks.filter(task => task['Status'] === APP_CONFIG.STATUS.PENDING).length,
    taskHistoryCount: history.length, createOrderAuditCount: audits.length
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function createProductionOrderUnderLock_(input) {
  const actor = requireAdmin_();
  const masters = validateOrderInput_(input);
  const workflow = getActiveWorkflow_();
  const timestamp = formatNow_();
  const orderId = generateIdUnderLock_(APP_CONFIG.ID_PREFIXES.ORDERS);
  const order = {
    'Order ID': orderId,
    'Customer ID': masters.customer['Customer ID'],
    'Customer Name': masters.customer['Customer Name'],
    'Product ID': masters.product['Product ID'],
    'Product Name': masters.product['Product Name'],
    'Garment Type': masters.product['Garment Type'] || '',
    'Size': masters.product['Size'] || '',
    'Color': masters.product['Color'] || '',
    'Quantity': asNumber_(input.quantity),
    'Unit': masters.product['Unit'] || input.unit || 'pcs',
    'Order Date': masters.orderDate,
    'Required Delivery Date': masters.requiredDeliveryDate,
    'Priority': input.priority || getSettingValue_('DEFAULT_TASK_PRIORITY', 'NORMAL'),
    'Created By': actor['Email'],
    'Created Date': timestamp,
    'Overall Status': APP_CONFIG.STATUS.READY,
    'Remarks': input.remarks || '',
    'Completed Quantity': 0,
    'Updated Date': timestamp
  };
  insertRecord(APP_CONFIG.SHEETS.PRODUCTION_ORDERS, order);
  createWorkflowTasksUnderLock_(order, workflow, actor);
  writeWorkflowAuditUnderLock_(actor, 'CREATE_ORDER', 'PRODUCTION_ORDER', orderId, null, order, 'Order and workflow tasks created.');
  return getOrderTracking(orderId);
}

function listProductionOrders() {
  requireAdmin_();
  return getSheetData(APP_CONFIG.SHEETS.PRODUCTION_ORDERS).map(toOrderDto_);
}

/** Full six-stage tracking view for an administrator. */
function getOrderTracking(orderId) {
  requireAdmin_();
  const order = getRecordById(APP_CONFIG.SHEETS.PRODUCTION_ORDERS, orderId);
  if (!order) throw new Error('Production order not found.');
  const tasks = getTasksForOrder_(orderId).sort((a, b) => Number(a['Workflow Step']) - Number(b['Workflow Step']));
  return {
    order: toOrderDto_(order),
    stages: tasks.map(toTaskDto_),
    progressPercent: calculateOrderProgress_(tasks)
  };
}

function validateOrderInput_(input) {
  if (!input) throw new Error('Order details are required.');
  const customer = getRecordById(APP_CONFIG.SHEETS.CUSTOMERS, input.customerId);
  const product = getRecordById(APP_CONFIG.SHEETS.PRODUCTS, input.productId);
  if (!customer || !isTrue_(customer['Active'])) throw new Error('Select an active customer.');
  if (!product || !isTrue_(product['Active'])) throw new Error('Select an active product.');
  if (asNumber_(input.quantity) <= 0) throw new Error('Order quantity must be greater than zero.');
  if (input.priority && !APP_CONFIG.PRIORITIES.includes(input.priority)) throw new Error('Invalid order priority.');
  const orderDate = input.orderDate ? new Date(input.orderDate) : new Date();
  const requiredDeliveryDate = input.requiredDeliveryDate ? new Date(input.requiredDeliveryDate) : null;
  if (Number.isNaN(orderDate.getTime())) throw new Error('Order date is invalid.');
  if (!requiredDeliveryDate || Number.isNaN(requiredDeliveryDate.getTime()) || requiredDeliveryDate <= orderDate) throw new Error('Required delivery date must be later than the order date.');
  return { customer: customer, product: product, orderDate: input.orderDate || formatNow_(), requiredDeliveryDate: input.requiredDeliveryDate };
}

function toOrderDto_(order) {
  return {
    orderId: order['Order ID'], customerName: order['Customer Name'], productName: order['Product Name'],
    quantity: asNumber_(order['Quantity']), completedQuantity: asNumber_(order['Completed Quantity']), unit: order['Unit'],
    orderDate: toClientValue_(order['Order Date']), requiredDeliveryDate: toClientValue_(order['Required Delivery Date']), priority: order['Priority'],
    status: order['Overall Status'], remarks: order['Remarks'], updatedDate: toClientValue_(order['Updated Date'])
  };
}
