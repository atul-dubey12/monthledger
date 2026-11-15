package com.monthledger.recurring;

import com.monthledger.category.Category;
import com.monthledger.category.CategoryRepository;
import com.monthledger.entry.EntryKind;
import com.monthledger.entry.PaymentMode;
import com.monthledger.goal.Goal;
import com.monthledger.goal.GoalRepository;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Monthly items. "Removing" one only stops it (active = false) so entries that paid it keep their link. */
@RestController
@RequestMapping("/api/recurring")
public class RecurringController {
    private static final BigDecimal MAX_AMOUNT = new BigDecimal("100000000");
    private final RecurringRepository recurring;
    private final CategoryRepository categories;
    private final GoalRepository goals;

    public RecurringController(RecurringRepository recurring, CategoryRepository categories, GoalRepository goals) {
        this.recurring = recurring;
        this.categories = categories;
        this.goals = goals;
    }

    public record RecurringRequest(String name, EntryKind kind, BigDecimal amount, Long categoryId, Long goalId, Integer dayOfMonth,
                                   PaymentMode paymentMode, Boolean active) {}

    /** Active items only, by day of month. */
    @GetMapping
    public List<Recurring> list() { return recurring.findAllByActiveTrueOrderByDayOfMonthAscIdAsc(); }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Recurring create(@RequestBody RecurringRequest request) {
        validate(request);
        Recurring item = new Recurring();
        apply(item, request);
        return recurring.save(item);
    }

    @PutMapping("/{id}")
    public Recurring update(@PathVariable Long id, @RequestBody RecurringRequest request) {
        Recurring item = recurring.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "This item no longer exists."));
        validate(request);
        apply(item, request);
        if (request.active() != null) item.setActive(request.active());
        return recurring.save(item);
    }

    private void apply(Recurring item, RecurringRequest request) {
        item.setName(request.name().trim());
        item.setKind(request.kind());
        item.setAmount(request.amount());
        item.setCategoryId(request.categoryId());
        item.setGoalId(request.kind() == EntryKind.SAVING ? request.goalId() : null);
        item.setDayOfMonth(request.dayOfMonth());
        item.setPaymentMode(request.paymentMode());
    }

    private void validate(RecurringRequest request) {
        if (request.name() == null || request.name().isBlank()) throw bad("Give it a name, e.g. Gym fee.");
        if (request.name().trim().length() > 40) throw bad("Names can be up to 40 characters.");
        if (request.kind() == null || request.kind() == EntryKind.SAVING_WITHDRAWAL) throw bad("Choose income, expense or saving.");
        BigDecimal amount = request.amount();
        if (amount == null || amount.signum() <= 0) throw bad("Enter an amount greater than ₹0.");
        if (amount.compareTo(MAX_AMOUNT) > 0) throw bad("That amount is too large.");
        if (amount.stripTrailingZeros().scale() > 2) throw bad("Amounts can have at most 2 decimal places (paise).");
        if (request.dayOfMonth() == null || request.dayOfMonth() < 1 || request.dayOfMonth() > 31) throw bad("Pick a day between 1 and 31.");
        if (request.categoryId() == null) throw bad("Pick a category.");
        Category category = categories.findById(request.categoryId()).orElseThrow(() -> bad("That category no longer exists."));
        if (category.isArchived()) throw bad("That category is hidden. Pick another one.");
        if (!request.kind().allows(category.getBucket())) throw bad(category.getName() + " can't be used for this kind of item.");
        if (request.goalId() != null && request.kind() == EntryKind.SAVING) {
            Goal goal = goals.findById(request.goalId()).orElseThrow(() -> bad("That goal no longer exists."));
            if (goal.isArchived()) throw bad("That goal is hidden. Pick another one.");
        }
    }

    private static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
}
