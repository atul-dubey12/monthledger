package com.monthledger.entry;

import java.time.LocalDate;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface EntryRepository extends JpaRepository<Entry, Long> {
    List<Entry> findByDateBetweenOrderByDateDescIdDesc(LocalDate from, LocalDate to);
    boolean existsByCategoryId(Long categoryId);

    /** [goalId, savings − withdrawals] for every goal that has linked entries. */
    @Query("select e.goalId, sum(case when e.kind = com.monthledger.entry.EntryKind.SAVING_WITHDRAWAL then -e.amount else e.amount end) "
         + "from Entry e where e.goalId is not null group by e.goalId")
    List<Object[]> netSavedByGoal();
}
