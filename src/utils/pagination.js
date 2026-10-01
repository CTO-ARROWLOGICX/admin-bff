// Same `meta.pagination` shape the monolith's admin listings returned.
const paginationMeta = (page, limit, totalItems) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  return {
    page,
    perPage: limit,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

module.exports = { paginationMeta };
