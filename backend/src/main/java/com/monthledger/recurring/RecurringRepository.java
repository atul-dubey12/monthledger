package com.monthledger.recurring;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RecurringRepository extends JpaRepository<Recurring, Long> {
    List<Recurring> findAllByActiveTrueOrderByDayOfMonthAscIdAsc();
}
