#ifndef SPCTRE_POLICY_CORE_H
#define SPCTRE_POLICY_CORE_H

#include <stddef.h>
#include <stdint.h>

enum spctre_policy_status {
  SPCTRE_POLICY_OK = 0,
  SPCTRE_POLICY_INVALID_REQUEST = 1,
  SPCTRE_POLICY_RESOURCE_LIMIT = 2,
  SPCTRE_POLICY_SERIALIZATION_ERROR = 3,
};

/* Evaluates bounded UTF-8 JSON. On success the caller must free `*out_ptr`. */
int32_t spctre_policy_evaluate(const uint8_t *request_ptr, size_t request_len,
                               uint8_t **out_ptr, size_t *out_len);
void spctre_policy_buffer_free(uint8_t *ptr, size_t len);

#endif
