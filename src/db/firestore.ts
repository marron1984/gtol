import { Firestore } from '@google-cloud/firestore';
import { EventMapping, UserConfig } from '../types';
import { logger } from '../utils/logger';

const MAPPINGS_COLLECTION = 'event_mappings';
const USERS_COLLECTION = 'user_configs';
const ERROR_QUEUE_COLLECTION = 'error_queue';

let db: Firestore;

export function getFirestore(): Firestore {
  if (!db) {
    db = new Firestore({
      projectId: process.env.FIRESTORE_PROJECT_ID,
    });
  }
  return db;
}

// ---------------------------------------------------------------------------
// Event Mapping operations
// ---------------------------------------------------------------------------

export async function getMappingByGoogleId(
  googleEventId: string,
  userId: string
): Promise<EventMapping | null> {
  const snapshot = await getFirestore()
    .collection(MAPPINGS_COLLECTION)
    .where('googleEventId', '==', googleEventId)
    .where('userId', '==', userId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as EventMapping;
}

export async function getMappingByLineworksId(
  lineworksEventId: string,
  userId: string
): Promise<EventMapping | null> {
  const snapshot = await getFirestore()
    .collection(MAPPINGS_COLLECTION)
    .where('lineworksEventId', '==', lineworksEventId)
    .where('userId', '==', userId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as EventMapping;
}

export async function upsertMapping(mapping: EventMapping): Promise<void> {
  const docId = `${mapping.userId}_${mapping.googleEventId}`;
  await getFirestore()
    .collection(MAPPINGS_COLLECTION)
    .doc(docId)
    .set(mapping, { merge: true });

  logger.info('upsert_mapping', {
    details: {
      googleEventId: mapping.googleEventId,
      lineworksEventId: mapping.lineworksEventId,
      userId: mapping.userId,
    },
  });
}

export async function deleteMapping(
  googleEventId: string,
  userId: string
): Promise<void> {
  const docId = `${userId}_${googleEventId}`;
  await getFirestore()
    .collection(MAPPINGS_COLLECTION)
    .doc(docId)
    .delete();

  logger.info('delete_mapping', {
    details: { googleEventId, userId },
  });
}

export async function getAllMappingsForUser(userId: string): Promise<EventMapping[]> {
  const snapshot = await getFirestore()
    .collection(MAPPINGS_COLLECTION)
    .where('userId', '==', userId)
    .get();

  return snapshot.docs.map((doc) => doc.data() as EventMapping);
}

// ---------------------------------------------------------------------------
// Error queue operations
// ---------------------------------------------------------------------------

export interface ErrorQueueEntry {
  userId: string;
  source: 'google' | 'lineworks';
  eventId: string;
  action: 'create' | 'update' | 'delete';
  error: string;
  createdAt: string;
  retryCount: number;
}

export async function pushErrorQueue(entry: ErrorQueueEntry): Promise<void> {
  await getFirestore()
    .collection(ERROR_QUEUE_COLLECTION)
    .add(entry);

  logger.error('push_error_queue', entry.error, {
    eventId: entry.eventId,
    source: entry.source,
  });
}

export async function popErrorQueue(userId: string): Promise<Array<ErrorQueueEntry & { docId: string }>> {
  const snapshot = await getFirestore()
    .collection(ERROR_QUEUE_COLLECTION)
    .where('userId', '==', userId)
    .orderBy('createdAt', 'asc')
    .limit(20)
    .get();

  return snapshot.docs.map((doc) => ({
    docId: doc.id,
    ...(doc.data() as ErrorQueueEntry),
  }));
}

export async function removeErrorQueueEntry(docId: string): Promise<void> {
  await getFirestore()
    .collection(ERROR_QUEUE_COLLECTION)
    .doc(docId)
    .delete();
}

// ---------------------------------------------------------------------------
// User config operations
// ---------------------------------------------------------------------------

export async function getUserConfig(userId: string): Promise<UserConfig | null> {
  const doc = await getFirestore()
    .collection(USERS_COLLECTION)
    .doc(userId)
    .get();

  if (!doc.exists) return null;
  return doc.data() as UserConfig;
}

export async function setUserConfig(config: UserConfig): Promise<void> {
  await getFirestore()
    .collection(USERS_COLLECTION)
    .doc(config.userId)
    .set(config, { merge: true });
}
