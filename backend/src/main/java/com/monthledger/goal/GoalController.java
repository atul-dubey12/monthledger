package com.monthledger.goal;

import com.monthledger.entry.EntryRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Goals are hidden (archived) rather than deleted, so entries that point at them stay valid. */
@RestController
@RequestMapping("/api/goals")
public class GoalController {
    private static final BigDecimal MAX_AMOUNT = new BigDecimal("100000000");
    private final GoalRepository goals;
    private final EntryRepository entries;

    public GoalController(GoalRepository goals, EntryRepository entries) {
        this.goals = goals;
        this.entries = entries;
    }

    public record GoalRequest(String name, String icon, BigDecimal targetAmount, BigDecimal startingAmount, LocalDate targetDate, Boolean archived) {}

    /** A goal plus how much is in it now: starting amount + savings linked to it − withdrawals linked to it. */
    public record GoalView(Long id, String name, String icon, BigDecimal targetAmount, BigDecimal startingAmount, LocalDate targetDate,
                           boolean archived, BigDecimal saved) {
        static GoalView of(Goal g, BigDecimal linked) {
            return new GoalView(g.getId(), g.getName(), g.getIcon(), g.getTargetAmount(), g.getStartingAmount(), g.getTargetDate(),
                g.isArchived(), g.getStartingAmount().add(linked));
        }
    }

    @GetMapping
    public List<GoalView> list() {
        Map<Long, BigDecimal> linked = new HashMap<>();
        for (Object[] row : entries.netSavedByGoal()) linked.put((Long) row[0], (BigDecimal) row[1]);
        return goals.findAllByOrderByArchivedAscIdAsc().stream().map(g -> GoalView.of(g, linked.getOrDefault(g.getId(), BigDecimal.ZERO))).toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public GoalView create(@RequestBody GoalRequest request) {
        validate(request);
        Goal goal = new Goal();
        apply(goal, request);
        return GoalView.of(goals.save(goal), BigDecimal.ZERO);
    }

    @PutMapping("/{id}")
    public GoalView update(@PathVariable Long id, @RequestBody GoalRequest request) {
        validate(request);
        Goal goal = goals.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "This goal no longer exists."));
        apply(goal, request);
        if (request.archived() != null) goal.setArchived(request.archived());
        goals.save(goal);
        return list().stream().filter(v -> v.id().equals(id)).findFirst().orElseThrow();
    }

    private void apply(Goal goal, GoalRequest request) {
        goal.setName(request.name().trim());
        goal.setIcon(request.icon() == null || request.icon().isBlank() ? "🎯" : request.icon().trim());
        goal.setTargetAmount(request.targetAmount());
        goal.setStartingAmount(request.startingAmount() == null ? BigDecimal.ZERO : request.startingAmount());
        goal.setTargetDate(request.targetDate());
    }

    private void validate(GoalRequest request) {
        if (request.name() == null || request.name().isBlank()) throw bad("Give the goal a name.");
        if (request.name().trim().length() > 40) throw bad("Goal names can be up to 40 characters.");
        if (request.icon() != null && request.icon().trim().length() > 8) throw bad("Pick a single emoji for the icon.");
        checkAmount(request.targetAmount(), "target", true);
        if (request.startingAmount() != null) checkAmount(request.startingAmount(), "already saved amount", false);
        if (request.targetDate() != null && request.targetDate().isAfter(LocalDate.now().plusYears(50))) throw bad("That target date is too far away.");
    }

    private void checkAmount(BigDecimal amount, String what, boolean mustBePositive) {
        if (amount == null || (mustBePositive ? amount.signum() <= 0 : amount.signum() < 0)) throw bad("Enter a " + what + (mustBePositive ? " greater than ₹0." : " of ₹0 or more."));
        if (amount.compareTo(MAX_AMOUNT) > 0) throw bad("That " + what + " is too large.");
        if (amount.stripTrailingZeros().scale() > 2) throw bad("Amounts can have at most 2 decimal places (paise).");
    }

    private static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
}
