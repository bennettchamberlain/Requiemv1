#!/usr/bin/env node
// Test LLM Integration

import { Application } from './configuration/types';
import { LLMJobService } from './services/llm-service';
import { queueAIJob } from './utils/job-queue-utils';

// Mock app for testing
const mockApp = {
  get: (key: string) => {
    if (key === 'postgresql') {
      return {
        connection: {
          host: 'localhost',
          port: 5432,
          database: 'compintel',
          user: 'postgres',
          password: 'password'
        }
      };
    }
    return null;
  },
  set: () => {},
  use: () => {},
  service: () => ({ hooks: () => {} })
} as unknown as Application;

async function testLLMJob() {
  console.log('🧪 Testing LLM Job Service Integration...');

  try {
    const llmJobService = new LLMJobService(mockApp);

    // Test job creation
    console.log('📝 Creating LLM generate job...');
    const result = await llmJobService.create({
      operation: 'generate',
      model: 'llama3.2',
      prompt: 'What is the capital of France?',
      jobOptions: {
        priority: 5,
        retryLimit: 3
      }
    });

    console.log('✅ LLM Job created successfully:', result);

    // Test job creation for chat
    console.log('💬 Creating LLM chat job...');
    const chatResult = await llmJobService.create({
      operation: 'chat',
      model: 'llama3.2',
      messages: [
        { role: 'user', content: 'Hello, how are you?' }
      ],
      jobOptions: {
        priority: 3
      }
    });

    console.log('✅ LLM Chat Job created successfully:', chatResult);

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

async function testDirectJobQueue() {
  console.log('🔧 Testing direct job queue integration...');

  try {
    const jobId = await queueAIJob(mockApp, 'llm-processing', {
      operation: 'generate',
      model: 'llama3.2',
      prompt: 'Test prompt for direct queue'
    }, {
      priority: 5,
      retryLimit: 2
    });

    console.log('✅ Direct job queued successfully:', jobId);

  } catch (error) {
    console.error('❌ Direct job queue test failed:', error);
  }
}

async function main() {
  console.log('🚀 Starting LLM Integration Tests...\n');

  await testLLMJob();
  console.log();
  await testDirectJobQueue();

  console.log('\n🎉 LLM Integration tests completed!');
}

if (require.main === module) {
  main().catch(console.error);
}
