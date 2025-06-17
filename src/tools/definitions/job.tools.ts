import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../utils/logger.js';
import { toolRegistry } from '../ToolRegistry.js';

export function registerJobTools() {
  // Register get_job_status tool
  const getJobStatusTool: Tool = {
    name: 'get_job_status',
    description: 'Get the status of a categorization job',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Job ID to retrieve'
        }
      },
      required: ['id']
    }
  };

  const listJobTool: Tool = {
    name: 'list_jobs',
    description: 'List all jobs',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of jobs to return',
          default: 50
        },
        offset: {
          type: 'number',
          description: 'Number of jobs to skip',
          default: 0
        },
        status: {
          type: 'string',
          enum: ['pending', 'running', 'completed', 'failed'],
          description: 'Filter jobs by status'
        },
        job_type:{
          type: 'string',
          enum: ['pending', 'running', 'completed', 'failed'],
          description: 'Filter jobs by status'
        }
    },
    required:["limit"]
  }
};

 const cancelJobTool: Tool = {
    name: 'cancel_job',
    description: 'Cancel a job',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Job ID to cancel'
        }
      },
      required: ['id']
    }
  };
  // Register tools with the registry
  toolRegistry.registerTool(getJobStatusTool, 'job_management');
  toolRegistry.registerTool(listJobTool, 'job_management');
  toolRegistry.registerTool(cancelJobTool, 'job_management');
  
}