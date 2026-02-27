/**
 * Web Worker for sensitive word detection
 * 
 * Runs sensitive word detection in a background thread to avoid blocking the UI.
 * Requirements: 11.1, 15.4
 */

import { SensitiveWordService, type SensitiveWordMatch } from '../services/SensitiveWordService';

// Worker message types
interface DetectMessage {
  type: 'detect';
  text: string;
  requestId: string;
}

interface LoadDictionaryMessage {
  type: 'loadDictionary';
  words: string[];
}

interface AddWordsMessage {
  type: 'addWords';
  words: string[];
}

interface RemoveWordsMessage {
  type: 'removeWords';
  words: string[];
}

type WorkerMessage = DetectMessage | LoadDictionaryMessage | AddWordsMessage | RemoveWordsMessage;

// Worker response types
interface DetectResponse {
  type: 'detectResult';
  matches: SensitiveWordMatch[];
  requestId: string;
}

interface ErrorResponse {
  type: 'error';
  error: string;
  requestId?: string;
}

// Initialize service instance
const service = new SensitiveWordService();

// Handle messages from main thread
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'detect': {
        // Detect sensitive words in text
        const matches = service.detectSensitiveWords(message.text);
        
        const response: DetectResponse = {
          type: 'detectResult',
          matches,
          requestId: message.requestId,
        };
        
        self.postMessage(response);
        break;
      }

      case 'loadDictionary': {
        // Load dictionary
        service.loadDictionary(message.words);
        break;
      }

      case 'addWords': {
        // Add custom words
        await service.addCustomWords(message.words);
        break;
      }

      case 'removeWords': {
        // Remove custom words
        await service.removeCustomWords(message.words);
        break;
      }

      default:
        throw new Error(`Unknown message type: ${(message as any).type}`);
    }
  } catch (error) {
    const errorResponse: ErrorResponse = {
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
      requestId: 'requestId' in message ? message.requestId : undefined,
    };
    
    self.postMessage(errorResponse);
  }
};

// Export empty object to make this a module
export {};
