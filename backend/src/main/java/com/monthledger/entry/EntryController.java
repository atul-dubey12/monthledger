package com.monthledger.entry;

import com.monthledger.category.Category;
import com.monthledger.category.CategoryRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/entries")
public class EntryController {
    private static final BigDecimal MAX_AMOUNT = new BigDecimal("100000000");
    private static final LocalDate EARLIEST = LocalDate.of(2000, 1, 1);
    /** A budget month is at most 31 days; a year leaves room for history views without unbounded scans. */
    private static final int MAX_RANGE_DAYS = 400;
    private final EntryRepository entries;
    private final CategoryRepository categories;

    public EntryController(EntryRepository entries, CategoryRepository categories) {
        this.entries = entries;
        this.categories = categories;
    }

    /** Newest first. Both dates are inclusive. */
    @GetMapping
    public List<Entry> list(@RequestParam LocalDate from, @RequestParam LocalDate to) {
        if (to.isBefore(from)) throw bad("'to' must be on or after 'from'.");
        if (from.plusDays(MAX_RANGE_DAYS).isBefore(to)) throw bad("Ask for at most " + MAX_RANGE_DAYS + " days at a time.");
        return entries.findByDateBetweenOrderByDateDescIdDesc(from, to);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Entry create(@RequestBody EntryRequest request) {
        validate(request, null);
        Entry entry = new Entry();
        apply(entry, request);
        return entries.save(entry);
    }

    @PutMapping("/{id}")
    public Entry update(@PathVariable Long id, @RequestBody EntryRequest request) {
        Entry entry = entries.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "This entry no longer exists."));
        validate(request, entry);
        apply(entry, request);
        return entries.save(entry);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        if (!entries.existsById(id)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "This entry no longer exists.");
        entries.deleteById(id);
    }

    private void apply(Entry entry, EntryRequest request) {
        entry.setDate(request.date());
        entry.setKind(request.kind());
        entry.setAmount(request.amount());
        entry.setCategoryId(request.categoryId());
        entry.setPaymentMode(request.paymentMode());
        String note = request.note() == null ? null : request.note().trim();
        entry.setNote(note == null || note.isEmpty() ? null : note);
    }

    private void validate(EntryRequest request, Entry existing) {
        if (request.kind() == null) throw bad("Choose income, expense or saving.");
        BigDecimal amount = request.amount();
        if (amount == null || amount.signum() <= 0) throw bad("Enter an amount greater than ₹0.");
        if (amount.compareTo(MAX_AMOUNT) > 0) throw bad("That amount is too large.");
        if (amount.stripTrailingZeros().scale() > 2) throw bad("Amounts can have at most 2 decimal places (paise).");
        if (request.date() == null) throw bad("Pick a date.");
        if (request.date().isBefore(EARLIEST)) throw bad("That date is too far in the past.");
        if (request.date().isAfter(LocalDate.now().plusYears(1))) throw bad("That date is too far in the future.");
        if (request.note() != null && request.note().trim().length() > 180) throw bad("Notes can be up to 180 characters.");
        if (request.categoryId() == null) throw bad("Pick a category.");
        Category category = categories.findById(request.categoryId()).orElseThrow(() -> bad("That category no longer exists."));
        // An archived category is fine on an entry that already used it, but not for new money.
        boolean keepsOldCategory = existing != null && existing.getCategoryId().equals(category.getId());
        if (category.isArchived() && !keepsOldCategory) throw bad("That category is archived. Pick another one.");
        if (!request.kind().allows(category.getBucket())) throw bad(category.getName() + " can't be used for this kind of entry.");
    }

    private static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
}
