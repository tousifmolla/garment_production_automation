/* Phase 5 deadline-monitoring and alert-engine dry run with an in-memory GAS mock. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
class Range { constructor(sheet,row,column,rows,columns){Object.assign(this,{sheet,row,column,rows,columns});} getValues(){return Array.from({length:this.rows},(_,r)=>Array.from({length:this.columns},(_,c)=>(this.sheet.rows[this.row-1+r]||[])[this.column-1+c]??''));} setValues(values){values.forEach((source,r)=>source.forEach((value,c)=>{const row=this.row-1+r;this.sheet.rows[row]||=[];this.sheet.rows[row][this.column-1+c]=value;}));return this;} setFontWeight(){return this;} setBackground(){return this;} setFontColor(){return this;} }
class Sheet { constructor(name){this.name=name;this.rows=[[]];} getLastColumn(){return this.rows.reduce((size,row)=>Math.max(size,row.length),0);} getLastRow(){return this.rows.length;} getRange(row,column,rows=1,columns=1){return new Range(this,row,column,rows,columns);} getDataRange(){return this.getRange(1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn()));} appendRow(row){this.rows.push([...row]);} deleteRow(row){this.rows.splice(row-1,1);} setFrozenRows(){} autoResizeColumns(){} }
class Spreadsheet { constructor(){this.sheets=new Map();} getId(){return 'phase5-dry-run';} getSheetByName(name){return this.sheets.get(name)||null;} insertSheet(name){const sheet=new Sheet(name);this.sheets.set(name,sheet);return sheet;} }
const spreadsheet=new Spreadsheet(); const properties=new Map(); let currentEmail='admin@example.com';
const context=vm.createContext({SpreadsheetApp:{getActiveSpreadsheet:()=>spreadsheet,openById:()=>spreadsheet,flush:()=>{}},PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key)||null,setProperty:(key,value)=>properties.set(key,value)})},LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},Session:{getActiveUser:()=>({getEmail:()=>currentEmail}),getScriptTimeZone:()=> 'Asia/Kolkata'},Utilities:{formatDate:()=> '2026-08-30 10:00:00'},Date,Error,Object,String,Number,Array,JSON});
['Config.gs','Utils.gs','Database.gs','Setup.gs','Auth.gs','Users.gs','Notifications.gs','Orders.gs','Workflow.gs','Tasks.gs','Alerts.gs'].forEach(file=>vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file}));
properties.set('GARMENT_INITIAL_ADMIN_EMAIL', currentEmail); context.initializeSystem(); context.bootstrapInitialAdmin();
context.createUser({email:'purchase@example.com',displayName:'Purchase Lead',role:'DEPARTMENT_USER',departmentId:'DEPT-001'});
context.createUser({email:'cutting@example.com',displayName:'Cutting Lead',role:'DEPARTMENT_USER',departmentId:'DEPT-002'});
context.insertRecord('Products',{'Product ID':'PROD-TEST','Product Name':'Polo Shirt',Unit:'pcs',Active:true}); context.insertRecord('Products',{'Product ID':'PROD-LATE','Product Name':'Kids Shirt',Unit:'pcs',Active:true}); context.insertRecord('Customers',{'Customer ID':'CUST-TEST','Customer Name':'Northwind',Active:true}); context.insertRecord('Customers',{'Customer ID':'CUST-LATE','Customer Name':'Late Customer',Active:true});
const order=context.createProductionOrder({customerId:'CUST-TEST',productId:'PROD-TEST',quantity:10,unit:'pcs',requiredDeliveryDate:new Date(Date.now()+86400000).toISOString()}).order;
let task=context.getOrderTracking(order.orderId).stages[0];
const nearDeadline=new Date(Date.now()+60*60*1000).toISOString();
context.updateRecord('Tasks',task.taskId,{'Deadline':nearDeadline,'Remaining Time Hours':1});
let monitor=context.monitorDeadlines();
assert.equal(monitor.success,true,'monitor completes');
let alerts=context.listAlerts({taskId:task.taskId});
assert.equal(alerts.length,1,'warning alert created'); assert.equal(alerts[0].severity,'YELLOW','warning severity detected');
context.monitorDeadlines(); assert.equal(context.listAlerts({taskId:task.taskId}).length,1,'repeated monitor does not duplicate warning');
currentEmail='purchase@example.com'; assert.equal(context.listMyAlerts().length,1,'department sees own alert'); assert.equal(context.acknowledgeAlert(alerts[0].alertId).status,'ACKNOWLEDGED','department can acknowledge own alert');
currentEmail='cutting@example.com'; assert.equal(context.listMyAlerts().length,0,'other department cannot see alert'); assert.throws(()=>context.acknowledgeAlert(alerts[0].alertId),/own department/,'other department cannot acknowledge');
currentEmail='admin@example.com';
const pastDeadline=new Date(Date.now()-2*60*60*1000).toISOString(); context.updateRecord('Tasks',task.taskId,{'Deadline':pastDeadline}); context.monitorDeadlines();
task=context.getRecordById('Tasks',task.taskId); alerts=context.listAlerts({taskId:task.taskId});
assert.equal(task.Status,'OVERDUE','deadline monitor marks active task overdue'); assert.equal(task['Overdue Flag'],true,'overdue flag is set'); assert.ok(alerts.some(alert=>alert.severity==='RED'&&alert.status==='OPEN'),'red overdue alert created'); assert.ok(alerts.some(alert=>alert.severity==='YELLOW'&&alert.status==='RESOLVED'),'obsolete warning resolved');
currentEmail='purchase@example.com'; context.startTask(task['Task ID']); context.completeTask(task['Task ID'],{quantityCompleted:10});
const completedBefore=context.getRecordById('Tasks',task['Task ID']); currentEmail='admin@example.com'; context.monitorDeadlines(); const completedAfter=context.getRecordById('Tasks',task['Task ID']);
assert.equal(completedAfter.Status,'COMPLETED','completed task is never changed to overdue'); assert.equal(completedAfter['Completed Date'],completedBefore['Completed Date'],'completed historical record remains intact'); assert.ok(context.listAlerts({taskId:task['Task ID']}).every(alert=>alert.status==='RESOLVED'),'task alerts resolve on completion');
const riskOrder=context.createProductionOrder({customerId:'CUST-LATE',productId:'PROD-LATE',quantity:5,orderDate:new Date(Date.now()-2*60*60*1000).toISOString(),requiredDeliveryDate:new Date(Date.now()-60*60*1000).toISOString()}).order;
context.monitorDeadlines(); const risk=context.listAlerts({orderId:riskOrder.orderId}).find(alert=>alert.type==='ORDER_DELIVERY_RISK');
assert.ok(risk,'delivery-risk alert created'); assert.equal(risk.severity,'RED','past delivery date is red risk');
console.log('Phase 5 dry run passed: deadline calculation, warning/overdue alerts, deduplication, resolution, authorization, completed-task exclusion, and delivery-risk detection succeeded.');
