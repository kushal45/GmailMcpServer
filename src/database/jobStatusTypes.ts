
export enum JobStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export interface Job {
  job_id: string;
  job_type: string;
  status: JobStatus;
  request_params: any;
  progress?: number;
  results?: any;
  error_details?: string;
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
}