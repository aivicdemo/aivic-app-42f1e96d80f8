import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand, DeleteCommand, UpdateCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { hasPermission, validateRole, Role } from './rbac';
import { randomUUID } from 'crypto';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.MAIN_TABLE!;

interface APIGatewayEvent {
  httpMethod: string;
  path: string;
  pathParameters?: { [key: string]: string };
  queryStringParameters?: { [key: string]: string };
  body?: string;
  headers: { [key: string]: string };
}

interface APIGatewayResponse {
  statusCode: number;
  headers: { [key: string]: string };
  body: string;
}

interface Student {
  pk: string;
  sk: string;
  studentId: string;
  studentName: string;
  birthDate: string;
  grade: number;
  enrollmentStatus: boolean;
  enrollmentDate: string;
  guardianId: string;
  createdAt: string;
  updatedAt: string;
}

interface Guardian {
  pk: string;
  sk: string;
  guardianId: string;
  guardianName: string;
  phoneNumber: string;
  email?: string;
  address?: string;
  registeredAt: string;
  createdAt: string;
  updatedAt: string;
}

interface TuitionFee {
  pk: string;
  sk: string;
  tuitionId: string;
  studentId: string;
  targetMonth: string;
  amount: number;
  isPaid: boolean;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface Attendance {
  pk: string;
  sk: string;
  attendanceId: string;
  studentId: string;
  classDate: string;
  attendanceStatus: string;
  isMakeup: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface AuditLog {
  pk: string;
  sk: string;
  action: string;
  userId: string;
  timestamp: string;
  details: string;
}

function createResponse(statusCode: number, body: any): APIGatewayResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    },
    body: JSON.stringify(body)
  };
}

function getUserRole(event: APIGatewayEvent): Role {
  const role = event.headers['x-user-role'] || event.headers['X-User-Role'] || 'viewer';
  return validateRole(role);
}

function getUserId(event: APIGatewayEvent): string {
  return event.headers['x-user-id'] || event.headers['X-User-Id'] || 'anonymous';
}

async function createAuditLog(action: string, userId: string, details: string): Promise<void> {
  const auditLog: AuditLog = {
    pk: 'AUDIT',
    sk: `${Date.now()}_${randomUUID()}`,
    action,
    userId,
    timestamp: new Date().toISOString(),
    details
  };

  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: auditLog
  }));
}

function validateStudent(data: any): Partial<Student> {
  const errors: string[] = [];
  
  if (!data.studentName || typeof data.studentName !== 'string' || data.studentName.length > 100) {
    errors.push('studentName is required and must be a string with max 100 characters');
  }
  
  if (!data.birthDate || isNaN(Date.parse(data.birthDate))) {
    errors.push('birthDate is required and must be a valid date');
  }
  
  if (data.grade === undefined || typeof data.grade !== 'number' || data.grade < 0 || data.grade > 12) {
    errors.push('grade is required and must be a number between 0-12');
  }
  
  if (data.enrollmentStatus === undefined || typeof data.enrollmentStatus !== 'boolean') {
    errors.push('enrollmentStatus is required and must be a boolean');
  }
  
  if (!data.enrollmentDate || isNaN(Date.parse(data.enrollmentDate))) {
    errors.push('enrollmentDate is required and must be a valid date');
  }
  
  if (!data.guardianId || typeof data.guardianId !== 'string') {
    errors.push('guardianId is required and must be a string');
  }
  
  if (errors.length > 0) {
    throw new Error(errors.join(', '));
  }
  
  return data;
}

function validateGuardian(data: any): Partial<Guardian> {
  const errors: string[] = [];
  
  if (!data.guardianName || typeof data.guardianName !== 'string' || data.guardianName.length > 100) {
    errors.push('guardianName is required and must be a string with max 100 characters');
  }
  
  if (!data.phoneNumber || typeof data.phoneNumber !== 'string' || data.phoneNumber.length > 100) {
    errors.push('phoneNumber is required and must be a string with max 100 characters');
  }
  
  if (data.email && (typeof data.email !== 'string' || data.email.length > 100)) {
    errors.push('email must be a string with max 100 characters');
  }
  
  if (!data.registeredAt || isNaN(Date.parse(data.registeredAt))) {
    errors.push('registeredAt is required and must be a valid date');
  }
  
  if (errors.length > 0) {
    throw new Error(errors.join(', '));
  }
  
  return data;
}

function validateTuitionFee(data: any): Partial<TuitionFee> {
  const errors: string[] = [];
  
  if (!data.studentId || typeof data.studentId !== 'string') {
    errors.push('studentId is required and must be a string');
  }
  
  if (!data.targetMonth || typeof data.targetMonth !== 'string' || !/^\d{4}-\d{2}$/.test(data.targetMonth)) {
    errors.push('targetMonth is required and must be in YYYY-MM format');
  }
  
  if (data.amount === undefined || typeof data.amount !== 'number' || data.amount < 0) {
    errors.push('amount is required and must be a non-negative number');
  }
  
  if (data.isPaid === undefined || typeof data.isPaid !== 'boolean') {
    errors.push('isPaid is required and must be a boolean');
  }
  
  if (data.paidAt && isNaN(Date.parse(data.paidAt))) {
    errors.push('paidAt must be a valid date');
  }
  
  if (errors.length > 0) {
    throw new Error(errors.join(', '));
  }
  
  return data;
}

function validateAttendance(data: any): Partial<Attendance> {
  const errors: string[] = [];
  
  if (!data.studentId || typeof data.studentId !== 'string') {
    errors.push('studentId is required and must be a string');
  }
  
  if (!data.classDate || isNaN(Date.parse(data.classDate))) {
    errors.push('classDate is required and must be a valid date');
  }
  
  if (!data.attendanceStatus || typeof data.attendanceStatus !== 'string' || data.attendanceStatus.length > 100) {
    errors.push('attendanceStatus is required and must be a string with max 100 characters');
  }
  
  if (data.isMakeup === undefined || typeof data.isMakeup !== 'boolean') {
    errors.push('isMakeup is required and must be a boolean');
  }
  
  if (errors.length > 0) {
    throw new Error(errors.join(', '));
  }
  
  return data;
}

async function handleGetResources(event: APIGatewayEvent): Promise<APIGatewayResponse> {
  try {
    const userRole = getUserRole(event);
    
    if (!hasPermission(userRole, 'read')) {
      return createResponse(403, { error: 'Insufficient permissions' });
    }

    const [studentsResult, guardiansResult, tuitionFeesResult, attendanceResult] = await Promise.all([
      docClient.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(pk, :studentPrefix)',
        ExpressionAttributeValues: { ':studentPrefix': 'STUDENT#' }
      })),
      docClient.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(pk, :guardianPrefix)',
        ExpressionAttributeValues: { ':guardianPrefix': 'GUARDIAN#' }
      })),
      docClient.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(pk, :tuitionPrefix)',
        ExpressionAttributeValues: { ':tuitionPrefix': 'TUITION#' }
      })),
      docClient.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(pk, :attendancePrefix)',
        ExpressionAttributeValues: { ':attendancePrefix': 'ATTENDANCE#' }
      }))
    ]);

    return createResponse(200, {
      students: studentsResult.Items || [],
      guardians: guardiansResult.Items || [],
      tuitionFees: tuitionFeesResult.Items || [],
      attendance: attendanceResult.Items || []
    });
  } catch (error) {
    console.error('Error getting resources:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
}

async function handleBulkImport(event: APIGatewayEvent): Promise<APIGatewayResponse> {
  try {
    const userRole = getUserRole(event);
    const userId = getUserId(event);
    
    if (!hasPermission(userRole, 'write')) {
      return createResponse(403, { error: 'Insufficient permissions' });
    }

    if (!event.body) {
      return createResponse(400, { error: 'Request body is required' });
    }

    const { items } = JSON.parse(event.body);
    
    if (!Array.isArray(items)) {
      return createResponse(400, { error: 'items must be an array' });
    }

    const tableIndex = event.pathParameters?.tableIndex;
    let pkPrefix: string;
    let validator: (data: any) => any;

    switch (tableIndex) {
      case '0':
        pkPrefix = 'STUDENT#';
        validator = validateStudent;
        break;
      case '1':
        pkPrefix = 'GUARDIAN#';
        validator = validateGuardian;
        break;
      case '2':
        pkPrefix = 'TUITION#';
        validator = validateTuitionFee;
        break;
      case '3':
        pkPrefix = 'ATTENDANCE#';
        validator = validateAttendance;
        break;
      default:
        return createResponse(400, { error: 'Invalid table index' });
    }

    let imported = 0;
    let failed = 0;
    const errors: string[] = [];
    const now = new Date().toISOString();

    // Process items in batches of 25 (DynamoDB BatchWrite limit)
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      const writeRequests = [];

      for (const item of batch) {
        try {
          validator(item);
          const id = randomUUID();
          const processedItem = {
            ...item,
            pk: `${pkPrefix}${id}`,
            sk: `${pkPrefix}${id}`,
            id,
            createdAt: now,
            updatedAt: now
          };

          writeRequests.push({
            PutRequest: {
              Item: processedItem
            }
          });
        } catch (error) {
          failed++;
          errors.push(`Item ${i + batch.indexOf(item)}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      if (writeRequests.length > 0) {
        try {
          await docClient.send(new BatchWriteCommand({
            RequestItems: {
              [TABLE_NAME]: writeRequests
            }
          }));
          imported += writeRequests.length;
        } catch (error) {
          failed += writeRequests.length;
          errors.push(`Batch write error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    await createAuditLog('BULK_IMPORT', userId, `Table: ${tableIndex}, Imported: ${imported}, Failed: ${failed}`);

    return createResponse(200, {
      imported,
      failed,
      errors
    });
  } catch (error) {
    console.error('Error in bulk import:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
}

export const handler = async (event: APIGatewayEvent): Promise<APIGatewayResponse> => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return createResponse(200, {});
    }

    const path = event.path;
    const method = event.httpMethod;

    if (method === 'GET' && path === '/resources') {
      return await handleGetResources(event);
    }

    if (method === 'POST' && path.match(/^\/api\/\d+\/bulk$/)) {
      return await handleBulkImport(event);
    }

    return createResponse(404, { error: 'Endpoint not found' });
  } catch (error) {
    console.error('Unhandled error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};