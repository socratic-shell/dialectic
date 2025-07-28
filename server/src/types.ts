// 💡: Shared types between MCP server and VSCode extension to ensure type safety
// across the IPC communication boundary and prevent protocol mismatches

// ANCHOR: present_review_params
/**
 * Parameters for the present-review MCP tool
 */
export interface PresentReviewParams {
  /** Markdown content of the review to display */
  content: string;
  
  /** How to handle the review content in the extension */
  mode: 'replace' | 'update-section' | 'append';
  
  /** Optional section name for update-section mode */
  section?: string;
  
  /** Base directory path for resolving relative file references */
  baseUri: string;
}
// ANCHOR_END: present_review_params

// ANCHOR: present_review_result
/**
 * Response from the present-review tool
 */
export interface PresentReviewResult {
  /** Whether the review was successfully presented */
  success: boolean;
  
  /** Optional message about the operation */
  message?: string;
}
// ANCHOR_END: present_review_result

/**
 * Parameters for log messages sent via IPC
 */
export interface LogParams {
  /** Log level */
  level: 'info' | 'error' | 'debug';
  
  /** Log message content */
  message: string;
}

/**
 * IPC message sent from MCP server to VSCode extension
 */
export interface IPCMessage {
  /** Message type identifier */
  type: 'present_review' | 'log';
  
  /** Message payload */
  payload: PresentReviewParams | LogParams;
  
  /** Unique message ID for response tracking */
  id: string;
}

/**
 * IPC response sent from VSCode extension back to MCP server
 */
export interface IPCResponse {
  /** Response to message with this ID */
  id: string;
  
  /** Whether the operation succeeded */
  success: boolean;
  
  /** Optional error message */
  error?: string;
}
