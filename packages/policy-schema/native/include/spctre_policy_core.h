#ifndef SPCTRE_POLICY_CORE_H
#define SPCTRE_POLICY_CORE_H

#include <stddef.h>
#include <stdint.h>

enum spctre_policy_status {
  SPCTRE_POLICY_OK = 0,
  SPCTRE_POLICY_INVALID_REQUEST = 1,
  SPCTRE_POLICY_RESOURCE_LIMIT = 2,
  SPCTRE_POLICY_SERIALIZATION_ERROR = 3,
  /* An evaluation panicked and was contained; the kernel state is unchanged. */
  SPCTRE_POLICY_INTERNAL_ERROR = 4,
};

/* Evaluates bounded UTF-8 JSON. On success the caller must free `*out_ptr`. */
int32_t spctre_policy_evaluate(const uint8_t *request_ptr, size_t request_len,
                               uint8_t **out_ptr, size_t *out_len);
/* Composes ordered layers, returning winning positions rather than rules so a
   host keeps rule fields this kernel does not model. Same ownership contract. */
int32_t spctre_policy_compose_layers(const uint8_t *request_ptr,
                                     size_t request_len, uint8_t **out_ptr,
                                     size_t *out_len);
void spctre_policy_buffer_free(uint8_t *ptr, size_t len);

#endif
