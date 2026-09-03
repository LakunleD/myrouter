export enum ErrorCode {
  INVALID_REQUEST = 'invalid_request',
  INVALID_API_KEY = 'invalid_api_key',
  MODEL_NOT_FOUND = 'model_not_found',
  PROVIDER_UNAVAILABLE = 'provider_unavailable',
  PROVIDER_RATE_LIMITED = 'provider_rate_limited',
  PROVIDER_TIMEOUT = 'provider_timeout',
  INTERNAL_ERROR = 'internal_error',
}

interface ErrorSpec {
  httpStatus: number;
  retryable: boolean;
  defaultMessage: string;
}

export const ERROR_SPECS: Record<ErrorCode, ErrorSpec> = {
  [ErrorCode.INVALID_REQUEST]: { httpStatus: 400, retryable: false, defaultMessage: 'Invalid request' },
  [ErrorCode.INVALID_API_KEY]: { httpStatus: 401, retryable: false, defaultMessage: 'Invalid API key' },
  [ErrorCode.MODEL_NOT_FOUND]: { httpStatus: 404, retryable: false, defaultMessage: 'Model not found' },
  [ErrorCode.PROVIDER_UNAVAILABLE]: {
    httpStatus: 502,
    retryable: true,
    defaultMessage: 'Upstream provider temporarily unavailable',
  },
  [ErrorCode.PROVIDER_RATE_LIMITED]: {
    httpStatus: 429,
    retryable: true,
    defaultMessage: 'Upstream provider rate limited the request',
  },
  [ErrorCode.PROVIDER_TIMEOUT]: { httpStatus: 504, retryable: true, defaultMessage: 'Upstream provider timed out' },
  [ErrorCode.INTERNAL_ERROR]: { httpStatus: 500, retryable: false, defaultMessage: 'Internal server error' },
};
