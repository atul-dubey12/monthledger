package com.monthledger.category;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CategoryRepository extends JpaRepository<Category, Long> {
    List<Category> findAllByOrderBySortOrderAscIdAsc();
    boolean existsByNameIgnoreCaseAndArchivedFalse(String name);
}
