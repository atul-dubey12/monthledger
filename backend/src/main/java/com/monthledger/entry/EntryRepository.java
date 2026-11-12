package com.monthledger.entry;

import java.time.LocalDate;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EntryRepository extends JpaRepository<Entry, Long> {
    List<Entry> findByDateBetweenOrderByDateDescIdDesc(LocalDate from, LocalDate to);
    boolean existsByCategoryId(Long categoryId);
}
